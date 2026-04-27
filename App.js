import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Button, FlatList, Alert, StyleSheet,
  ScrollView, TouchableOpacity, Modal
} from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from './src/supabase';

export default function App() {
  const [materialCode, setMaterialCode] = useState('');
  const [materialInfo, setMaterialInfo] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('base');
  const [inventory, setInventory] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newMaterial, setNewMaterial] = useState({ code: '', name: '', baseUnit: '', packUnit: '', packRatio: '1' });

  useEffect(() => {
    NfcManager.start();
    fetchInventory();
    return () => NfcManager.stop();
  }, []);

  const fetchInventory = async () => {
    const { data, error } = await supabase
      .from('inventory')
      .select('material_code, quantity')
      .order('material_code');
    if (error) {
      Alert.alert('错误', error.message);
      return;
    }
    const { data: mats } = await supabase.from('materials').select('code, name, base_unit, pack_unit, pack_ratio');
    const merged = data.map(inv => ({
      ...inv,
      ...mats?.find(m => m.code === inv.material_code)
    }));
    setInventory(merged);
  };

  const fetchMaterialInfo = async (code) => {
    if (!code) return;
    const { data } = await supabase.from('materials').select('*').eq('code', code).single();
    setMaterialInfo(data || null);
    if (!data && code) Alert.alert('未知物料', '请先在后台建立此物料编号');
  };

  const readNFC = async () => {
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      if (tag?.ndefMessage?.[0]?.payload) {
        const payload = tag.ndefMessage[0].payload;
        let text = '';
        const langLength = payload[0] & 0x1F;
        text = String.fromCharCode(...payload.slice(langLength + 1));
        setMaterialCode(text);
        fetchMaterialInfo(text);
        Alert.alert('扫描成功', `物料: ${text}`);
      } else {
        Alert.alert('无数据', '请先使用「写入NFC」功能将物料编号写入标签');
      }
    } catch (err) {
      Alert.alert('扫描失败', err.message);
    } finally {
      NfcManager.cancelTechnologyRequest();
    }
  };

  const writeNFC = async () => {
    if (!materialCode) return Alert.alert('请先输入物料编号');
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const encoder = new TextEncoder();
      const bytes = encoder.encode(materialCode);
      const record = {
        tnf: NfcManager.ndef.TNF_WELL_KNOWN,
        type: NfcManager.ndef.RTD_TEXT,
        id: [],
        payload: bytes,
      };
      await NfcManager.ndefHandler.writeNdefMessage([record]);
      Alert.alert('写入成功', `标签已写入 ${materialCode}`);
    } catch (err) {
      Alert.alert('写入失败', err.message);
    } finally {
      NfcManager.cancelTechnologyRequest();
    }
  };

  const addMaterial = async () => {
    const { code, name, baseUnit, packUnit, packRatio } = newMaterial;
    if (!code || !name || !baseUnit) {
      return Alert.alert('请填写完整（编号、名称、基本单位）');
    }
    const { error } = await supabase
      .from('materials')
      .insert([{ code, name, base_unit: baseUnit, pack_unit: packUnit || null, pack_ratio: parseFloat(packRatio || 1) }]);
    if (error) {
      Alert.alert('错误', error.message);
      return;
    }
    await supabase.from('inventory').insert([{ material_code: code, quantity: 0 }]);
    Alert.alert('新增成功');
    setModalVisible(false);
    setNewMaterial({ code: '', name: '', baseUnit: '', packUnit: '', packRatio: '1' });
    fetchInventory();
  };

  const submitTransaction = async (type) => {
    if (!materialCode || !quantity || parseFloat(quantity) <= 0) {
      return Alert.alert('请扫描物料并输入有效数量');
    }
    if (!materialInfo) return Alert.alert('请先扫描或选择物料');

    const qtyNum = parseFloat(quantity);
    let baseQty = qtyNum;
    if (unit === 'pack' && materialInfo.pack_ratio) {
      baseQty = qtyNum * materialInfo.pack_ratio;
    }

    const { data: currInv } = await supabase
      .from('inventory')
      .select('quantity')
      .eq('material_code', materialCode)
      .single();
    const beforeBase = currInv?.quantity || 0;
    let afterBase = beforeBase;
    if (type === 'in') afterBase = beforeBase + baseQty;
    if (type === 'out') afterBase = beforeBase - baseQty;
    if (type === 'count') afterBase = baseQty;

    if (type === 'out' && afterBase < 0) {
      return Alert.alert('库存不足', `目前库存 ${beforeBase} ${materialInfo.base_unit}`);
    }

    const { error: upsertErr } = await supabase
      .from('inventory')
      .upsert({ material_code: materialCode, quantity: afterBase });
    if (upsertErr) return Alert.alert('库存更新失败', upsertErr.message);

    const { error: logErr } = await supabase
      .from('transactions')
      .insert({
        material_code: materialCode,
        type,
        unit: unit === 'base' ? materialInfo.base_unit : materialInfo.pack_unit,
        qty: qtyNum,
        base_qty: baseQty,
        before_base_qty: beforeBase,
        after_base_qty: afterBase,
      });
    if (logErr) console.warn(logErr);

    Alert.alert('完成', `${type === 'in' ? '入库' : type === 'out' ? '出库' : '盘点'}成功，新库存: ${afterBase} ${materialInfo.base_unit}`);
    setQuantity('');
    fetchInventory();
    fetchMaterialInfo(materialCode);
  };

  const exportTodayCSV = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows, error } = await supabase
      .from('transactions')
      .select(`*, materials(name)`)
      .gte('created_at', `${today}T00:00:00`)
      .lte('created_at', `${today}T23:59:59`)
      .order('created_at', { ascending: false });
    if (error) return Alert.alert('汇出失败', error.message);
    if (!rows || rows.length === 0) return Alert.alert('无资料', '今天尚无任何交易记录');

    const headers = ['时间', '物料编号', '物料名称', '类型', '操作单位', '数量', '基本数量', '异动前库存', '异动后库存'];
    const csvRows = rows.map(r => [
      r.created_at,
      r.material_code,
      r.materials?.name || '',
      r.type === 'in' ? '入库' : r.type === 'out' ? '出库' : '盘点',
      r.unit,
      r.qty,
      r.base_qty,
      r.before_base_qty,
      r.after_base_qty
    ]);
    const csvContent = [headers, ...csvRows].map(row => row.join(',')).join('\n');
    const filePath = FileSystem.documentDirectory + `inventory_${today}.csv`;
    await FileSystem.writeAsStringAsync(filePath, csvContent, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(filePath);
    } else {
      Alert.alert('无法分享', '请安装支援分享的应用');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>📦 物料 NFC 管理</Text>

      <View style={styles.row}>
        <Button title="📡 扫描 NFC" onPress={readNFC} />
        <Button title="✍️ 写入 NFC" onPress={writeNFC} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="物料编号"
        value={materialCode}
        onChangeText={(text) => { setMaterialCode(text); fetchMaterialInfo(text); }}
      />
      {materialInfo && (
        <View style={styles.card}>
          <Text>📌 {materialInfo.name} ({materialInfo.code})</Text>
          <Text>基本单位: {materialInfo.base_unit}</Text>
          {materialInfo.pack_unit && <Text>包装单位: {materialInfo.pack_unit} (1 {materialInfo.pack_unit} = {materialInfo.pack_ratio} {materialInfo.base_unit})</Text>}
        </View>
      )}

      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 2 }]}
          placeholder="数量"
          keyboardType="numeric"
          value={quantity}
          onChangeText={setQuantity}
        />
        <View style={styles.unitGroup}>
          <TouchableOpacity onPress={() => setUnit('base')} style={[styles.unitBtn, unit === 'base' && styles.activeUnit]}>
            <Text>{materialInfo?.base_unit || '个'}</Text>
          </TouchableOpacity>
          {materialInfo?.pack_unit && (
            <TouchableOpacity onPress={() => setUnit('pack')} style={[styles.unitBtn, unit === 'pack' && styles.activeUnit]}>
              <Text>{materialInfo.pack_unit}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.row}>
        <Button title="📥 入库" onPress={() => submitTransaction('in')} />
        <Button title="📤 出库" onPress={() => submitTransaction('out')} />
        <Button title="🔍 盘点" onPress={() => submitTransaction('count')} />
      </View>

      <View style={styles.row}>
        <Button title="➕ 新增物料" onPress={() => setModalVisible(true)} />
        <Button title="📎 汇出今日 Excel" onPress={exportTodayCSV} />
      </View>

      <Text style={styles.subtitle}>📋 目前库存</Text>
      <FlatList
        data={inventory}
        keyExtractor={item => item.material_code}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <View>
              <Text style={{ fontWeight: 'bold' }}>{item.material_code} - {item.name}</Text>
              <Text>库存: {item.quantity} {item.base_unit}</Text>
            </View>
            {item.pack_unit && (
              <Text>{Math.floor(item.quantity / item.pack_ratio)} {item.pack_unit}</Text>
            )}
          </View>
        )}
      />

      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalView}>
          <Text style={styles.modalTitle}>新增物料</Text>
          <TextInput placeholder="物料编号" style={styles.input} value={newMaterial.code} onChangeText={t => setNewMaterial({...newMaterial, code: t})} />
          <TextInput placeholder="物料名称" style={styles.input} value={newMaterial.name} onChangeText={t => setNewMaterial({...newMaterial, name: t})} />
          <TextInput placeholder="基本单位 (个/箱/等)" style={styles.input} value={newMaterial.baseUnit} onChangeText={t => setNewMaterial({...newMaterial, baseUnit: t})} />
          <TextInput placeholder="包装单位 (选填)" style={styles.input} value={newMaterial.packUnit} onChangeText={t => setNewMaterial({...newMaterial, packUnit: t})} />
          <TextInput placeholder="换算率 (1包=?基本单位)" style={styles.input} keyboardType="numeric" value={newMaterial.packRatio} onChangeText={t => setNewMaterial({...newMaterial, packRatio: t})} />
          <View style={styles.row}>
            <Button title="储存" onPress={addMaterial} />
            <Button title="取消" onPress={() => setModalVisible(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, marginTop: 40, flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#aaa', padding: 10, marginVertical: 6, borderRadius: 8, backgroundColor: '#fff' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 8, gap: 10 },
  card: { backgroundColor: '#e3f2fd', padding: 12, borderRadius: 8, marginVertical: 8 },
  subtitle: { fontSize: 18, fontWeight: 'bold', marginTop: 20, marginBottom: 8 },
  item: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: '#ddd' },
  unitGroup: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  unitBtn: { padding: 10, backgroundColor: '#ddd', borderRadius: 8, minWidth: 50, alignItems: 'center' },
  activeUnit: { backgroundColor: '#2196f3' },
  modalView: { margin: 50, backgroundColor: 'white', borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' }
});