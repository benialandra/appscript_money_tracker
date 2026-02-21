/* ==================================================
   BACKEND SYSTEM - DOMPETKU PRO (FULL INTEGRATED)
   ================================================== */

function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('Isi Dompet')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

/* --- AUTH --- */
function doLogin(username, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('user');
  if (!sheet) return { success: false, message: "Error: Sheet 'user' tidak ditemukan!" };
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(username).trim() && String(data[i][2]).trim() === String(password).trim()) {
      return { success: true };
    }
  }
  return { success: false, message: "Username atau Password salah!" };
}

function changeUserPassword(username, oldPass, newPass) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("user");
  if (sh) {
    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][1]).trim() === String(username).trim() && String(d[i][2]).trim() === String(oldPass).trim()) {
        sh.getRange(i + 1, 3).setValue(newPass);
        sh.getRange(i + 1, 4).setValue(new Date());
        return { success: true, message: "Password berhasil diupdate" };
      }
    }
  }
  return { success: false, message: "Gagal update: Username atau Password Lama salah" };
}

/* --- DASHBOARD DATA --- */
function getDashboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();
  const currentMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  // Helper Sum Sheet
  const sumSheet = (name, colIndex) => {
    const sheet = ss.getSheetByName(name);
    let sum = 0;
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        sum += (parseFloat(data[i][colIndex]) || 0);
      }
    }
    return sum;
  };

  // 1. POS KEUANGAN
  let totalBank = sumSheet('bank', 2);
  let totalEwallet = sumSheet('ewallet', 2);
  let totalTunai = sumSheet('tunai', 2);
  let totalInvestasi = sumSheet('investasi', 3);
  let totalTabungan = sumSheet('tabungan', 1);

  // 2. HUTANG & PIUTANG (YANG BELUM LUNAS)
  let totalHutang = 0;
  let totalPiutang = 0;
  const sheetHutang = ss.getSheetByName('hutang');
  if (sheetHutang && sheetHutang.getLastRow() > 1) {
    const data = sheetHutang.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const jenis = String(data[i][1]).toUpperCase(); // Kolom B
      const sisa = parseFloat(data[i][5]) || 0;       // Kolom F (Sisa)
      const status = String(data[i][6]);              // Kolom G

      if (status !== 'Lunas') {
        if (jenis.includes('HUTANG')) totalHutang += sisa;
        if (jenis.includes('PIUTANG')) totalPiutang += sisa;
      }
    }
  }

  // 3. RENCANA (BULAN INI & BELUM LUNAS)
  let totalRencana = 0;
  const sheetRencana = ss.getSheetByName('rencana');
  if (sheetRencana && sheetRencana.getLastRow() > 1) {
    const data = sheetRencana.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const tglRencana = data[i][4] ? Utilities.formatDate(new Date(data[i][4]), tz, 'yyyy-MM') : '';
      const sisaTagihan = parseFloat(data[i][3]) || 0;
      if (tglRencana === currentMonth && sisaTagihan > 0) {
        totalRencana += sisaTagihan;
      }
    }
  }

  // 4. TRANSAKSI (CHART)
  let incomeMonth = 0;
  let expenseMonth = 0;
  const sheetTrx = ss.getSheetByName('transaksi');
  let recents = [];

  if (sheetTrx && sheetTrx.getLastRow() > 1) {
    const allTrx = sheetTrx.getDataRange().getValues();
    allTrx.shift();

    allTrx.forEach(r => {
      const tglTrx = r[8] ? Utilities.formatDate(new Date(r[8]), tz, 'yyyy-MM') : '';
      if (tglTrx === currentMonth) {
        const nominal = parseFloat(r[5]) || 0;
        if (r[1] === 'PEMASUKAN') incomeMonth += nominal;
        if (r[1] === 'PENGELUARAN') expenseMonth += Math.abs(nominal);
      }
    });

    const last10 = allTrx.slice(-5).reverse();
    recents = last10.map(r => ({
      kode: r[1],
      kategori: r[4] || r[2],
      ket: r[3],
      nominal: r[5],
      tgl: formatDate(r[8])
    }));
  }

  // 5. RUMUS DANA BEBAS (CARD 1)
  // (bank+ewallet+tunai+investasi+hutang)-tabungan-rencana-piutang
  const sisaUang = (totalBank + totalEwallet + totalTunai + totalPiutang) - totalTabungan - totalRencana - totalHutang;
  touchDataUpdate();
  return {
    card1: sisaUang,
    card2: expenseMonth,
    card3: totalRencana,
    card4: totalInvestasi, // Total Investasi
    chart: { in: incomeMonth, out: expenseMonth },
    recents: recents
  };
}

/* --- MASTER DATA CRUD --- */
function getMasterData(type) {
  const sheet = getSheetSafe(type);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  data.shift();
  touchDataUpdate();
  return data.map(r => {
    if (type === 'hutang') return { id: r[0], kategori: r[1], keterangan: r[2], sumber: r[3], saldo_awal: r[4], saldo_akhir: r[5], status: r[6], tanggal: formatDate(r[7]) };
    else if (type === 'investasi' || type === 'rencana') return { id: r[0], nama: r[1], kategori: r[2], saldo: r[3], tanggal: formatDate(r[4]), raw_date: (r[4] ? Utilities.formatDate(new Date(r[4]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '') };
    else if (type === 'tabungan') return { id: r[0], saldo: r[1], nama: r[2], tanggal: formatDate(r[3]) };
    else return { id: r[0], nama: r[1], saldo: r[2], tanggal: formatDate(r[3]) };
  });
}

function saveMasterData(type, form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(type);
  const now = new Date();
  const saldoBersih = parseFloat(String(form.f_saldo).replace(/\./g, '')) || 0;

  let rowIndex = -1;
  const data = sheet.getDataRange().getValues();

  // Cek Edit Mode
  if (form.id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(form.id)) {
        rowIndex = i + 1;
        break;
      }
    }
  }

  // Jika Baru
  if (rowIndex === -1) {
    rowIndex = sheet.getLastRow() + 1;
    sheet.getRange(rowIndex, 1).setValue('ID-' + type.toUpperCase() + '-' + Date.now());
  }

  if (type === 'hutang') {
    // LOGIKA KHUSUS HUTANG: TIDAK UPDATE SALDO REAL SAAT CREATE
    sheet.getRange(rowIndex, 2).setValue(form.f_kategori);
    sheet.getRange(rowIndex, 3).setValue(form.f_keterangan.toUpperCase());
    sheet.getRange(rowIndex, 4).setValue("-"); // Sumber Dana Kosong Dulu

    if (!form.id) {
      sheet.getRange(rowIndex, 5).setValue(saldoBersih); // Awal
      sheet.getRange(rowIndex, 6).setValue(saldoBersih); // Sisa
    }

    sheet.getRange(rowIndex, 7).setValue(form.f_status); // Belum Lunas
    sheet.getRange(rowIndex, 8).setValue(form.f_tanggal || now);

  } else if (type === 'investasi' || type === 'rencana') {
    sheet.getRange(rowIndex, 2).setValue(form.f_nama.toUpperCase());
    sheet.getRange(rowIndex, 3).setValue(form.f_kategori.toUpperCase());
    sheet.getRange(rowIndex, 4).setValue(saldoBersih);
    sheet.getRange(rowIndex, 5).setValue(form.f_tanggal || now);
  } else if (type === 'tabungan') {
    sheet.getRange(rowIndex, 2).setValue(saldoBersih);
    sheet.getRange(rowIndex, 3).setValue(form.f_nama.toUpperCase());
    sheet.getRange(rowIndex, 4).setValue(now);
  } else {
    sheet.getRange(rowIndex, 2).setValue(form.f_nama.toUpperCase());
    sheet.getRange(rowIndex, 3).setValue(saldoBersih);
    sheet.getRange(rowIndex, 4).setValue(now);
  }
  touchDataUpdate();
  return { success: true };
}

function deleteMasterData(type, id) {
  const sheet = getSheetSafe(type);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) { if (String(data[i][0]) === String(id)) { sheet.deleteRow(i + 1); return { success: true }; } }
  touchDataUpdate(); return { success: false };
}

/* --- TRANSACTION & PAYMENT LOGIC --- */

// FUNGSI PEMBAYARAN HUTANG/PIUTANG
/* --- UPDATE: FUNGSI BAYAR DENGAN VALIDASI SALDO --- */
function processDebtPayment(form) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetHutang = ss.getSheetByName('hutang');
  const sheetTrx = ss.getSheetByName('transaksi');
  const now = new Date();

  const idHutang = form.p_id;
  const nominalBayar = parseFloat(String(form.p_nominal).replace(/\./g, '')) || 0;
  const akunSumber = JSON.parse(form.p_sumber);
  const namaSumberDana = akunSumber.name.toUpperCase();
  const keterangan = (form.p_keterangan || "").toUpperCase();

  // 1. CEK DATA HUTANG
  const dataHutang = sheetHutang.getDataRange().getValues();
  let kategori = "";
  let namaHutang = "";
  let rowIdx = -1;
  let sisaLama = 0;

  for (let i = 1; i < dataHutang.length; i++) {
    if (String(dataHutang[i][0]) === String(idHutang)) {
      kategori = String(dataHutang[i][1]).toUpperCase().trim();
      namaHutang = dataHutang[i][2];
      sisaLama = parseFloat(dataHutang[i][5]) || 0;
      rowIdx = i + 1;
      break;
    }
  }

  if (rowIdx === -1) return { success: false, message: "Data hutang tidak ditemukan!" };

  // --- VALIDASI SALDO (LOGIC BARU) ---
  // Jika ini Bayar Hutang (Uang Keluar), cek apakah saldo sumber cukup
  if (kategori === 'HUTANG') {
    // Ambil saldo terbaru dari DB untuk keamanan
    const saldoSaatIni = getSaldoSaatIni(akunSumber);
    if (saldoSaatIni < nominalBayar) {
      return {
        success: false,
        message: `Saldo ${namaSumberDana} tidak cukup! (Sisa: ${formatRupiahSimple(saldoSaatIni)})`
      };
    }
  }
  // -------------------------------------

  // 2. UPDATE DATA HUTANG
  let sisaBaru = sisaLama - nominalBayar;
  let hutangLunas = false;

  if (sisaBaru <= 0) {
    sisaBaru = 0;
    hutangLunas = true;
    sheetHutang.getRange(rowIdx, 7).setValue('Lunas');
  }

  sheetHutang.getRange(rowIdx, 4).setValue(namaSumberDana);
  sheetHutang.getRange(rowIdx, 6).setValue(sisaBaru);
  sheetHutang.getRange(rowIdx, 8).setValue(now);

  // 3. UPDATE SALDO REAL
  let pengali = (kategori === 'HUTANG') ? -1 : 1;
  const perubahanSaldo = nominalBayar * pengali;
  const resSaldo = updateSaldoMaster(akunSumber, perubahanSaldo);

  // 4. CATAT MUTASI
  let tipeTrx = (kategori === 'HUTANG') ? 'PENGELUARAN' : 'PEMASUKAN';
  let labelTransaksi = (kategori === 'HUTANG') ? 'PELUNASAN HUTANG' : 'PENERIMAAN PIUTANG';
  let ketLog = `${labelTransaksi}: ${namaHutang}`;
  if (keterangan) ketLog += ` (${keterangan})`;
  if (hutangLunas) ketLog += " [LUNAS]";

  if (sheetTrx) {
    sheetTrx.appendRow([
      'TRX-PAY-' + Date.now(),
      tipeTrx,
      labelTransaksi,
      ketLog,
      namaSumberDana,
      perubahanSaldo,
      resSaldo.saldoAwal,
      resSaldo.saldoAkhir,
      now
    ]);
  }
  touchDataUpdate();
  return { success: true, message: "Pembayaran berhasil diproses!" };
}

function saveTransaction(form) {
  const sheetTrx = getSheetSafe('transaksi');
  const nominal = parseFloat(String(form.t_nominal).replace(/\./g, ''));
  const sumberInfo = JSON.parse(form.t_sumber);
  const tanggal = form.t_tanggal;
  const jenis = form.t_jenis;

  if (isNaN(nominal) || nominal <= 0) return { success: false, message: "Nominal tidak valid" };

  if (jenis === 'Transfer') {
    const destInfo = JSON.parse(form.t_tujuan_transfer);
    if (sumberInfo.id === destInfo.id) return { success: false, message: "Akun Asal dan Tujuan sama!" };
    const saldoAsal = getSaldoSaatIni(sumberInfo);
    if (saldoAsal < nominal) return { success: false, message: `Saldo ${sumberInfo.name} kurang!` };

    const resAsal = updateSaldoMaster(sumberInfo, -nominal);
    const resTujuan = updateSaldoMaster(destInfo, nominal);

    sheetTrx.appendRow(['TRX-' + Date.now() + '-OUT', 'TRANSFER', 'TRANSFER KELUAR', `TRF KE ${destInfo.name.toUpperCase()}`, sumberInfo.name.toUpperCase(), -nominal, resAsal.saldoAwal, resAsal.saldoAkhir, tanggal]);
    sheetTrx.appendRow(['TRX-' + Date.now() + '-IN', 'TRANSFER', 'TRANSFER MASUK', `TRF DARI ${sumberInfo.name.toUpperCase()}`, destInfo.name.toUpperCase(), nominal, resTujuan.saldoAwal, resTujuan.saldoAkhir, tanggal]);
    return { success: true, message: "Transfer Berhasil!" };
  } else {
    // Masuk / Keluar
    const katUpper = form.t_kategori.toUpperCase();
    const ketManual = form.t_manual ? form.t_manual.toUpperCase() : '';
    const ketFromDropdown = form.t_keterangan.toUpperCase();
    let logKet = ketManual !== '' ? ketManual : ketFromDropdown;

    // Logic Khusus Rencana
    if (katUpper.includes('RENCANA')) {
      const res = processPlanLogic(ketFromDropdown, nominal);
      if (!ketManual) { logKet = (res.type === 'RUTIN') ? `${ketFromDropdown} (TAGIHAN LUNAS)` : `${ketFromDropdown} (SISA BUDGET: ${formatRupiahSimple(res.sisa)})`; }
    }

    // Cek Saldo untuk Pengeluaran
    if (jenis === 'Keluar') {
      if (getSaldoSaatIni(sumberInfo) < nominal) return { success: false, message: `Saldo ${sumberInfo.name} tidak cukup!` };
    }

    const nominalFinal = (jenis === 'Masuk') ? nominal : -nominal;
    let kode = (jenis === 'Masuk') ? 'PEMASUKAN' : 'PENGELUARAN';
    const res = updateSaldoMaster(sumberInfo, nominalFinal);
    sheetTrx.appendRow(['TRX-' + Date.now(), kode, form.t_kategori.toUpperCase(), logKet, sumberInfo.name.toUpperCase(), nominalFinal, res.saldoAwal, res.saldoAkhir, tanggal]);
    touchDataUpdate();
    return { success: true, message: "Transaksi disimpan!" };
  }
}

/* --- HELPERS --- */
function updateSaldoMaster(info, n) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(info.type);
  if (!sheet) return { saldoAwal: 0, saldoAkhir: 0 };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(info.id)) {
      let colIdx = 2; // Default
      if (info.type === 'investasi') colIdx = 3;
      if (info.type === 'tabungan') colIdx = 1;

      const sa = parseFloat(data[i][colIdx]) || 0;
      const sak = sa + n;

      sheet.getRange(i + 1, colIdx + 1).setValue(sak);
      // Update Date
      let colDate = 4;
      if (info.type === 'investasi') colDate = 5;
      if (sheet.getLastColumn() >= colDate) sheet.getRange(i + 1, colDate).setValue(new Date());
      return { saldoAwal: sa, saldoAkhir: sak };
    }
  }
  touchDataUpdate();
  return { saldoAwal: 0, saldoAkhir: 0 };
}
function getAllMasterDataForExport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const getData = (sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    const headers = data.shift(); // Ambil header
    // Map array ke object
    return data.map(row => {
      let obj = {};
      headers.forEach((h, i) => {
        // Format tanggal jika kolom mengandung tanggal
        if (row[i] instanceof Date) {
           obj[h] = Utilities.formatDate(row[i], Session.getScriptTimeZone(), 'dd/MM/yyyy');
        } else {
           obj[h] = row[i];
        }
      });
      return obj;
    });
  };

  return {
    bank: getData('bank'),
    investasi: getData('investasi'),
    rencana: getData('rencana'),
    hutang: getData('hutang'),
    ewallet: getData('ewallet'),
    tunai: getData('tunai')
  };
}
function getSaldoSaatIni(info) { const ss = SpreadsheetApp.getActiveSpreadsheet(); const s = ss.getSheetByName(info.type); const d = s.getDataRange().getValues(); let colIdx = 2; if (info.type === 'investasi') colIdx = 3; if (info.type === 'tabungan') colIdx = 1; for (let i = 1; i < d.length; i++) { if (String(d[i][0]) === String(info.id)) return parseFloat(d[i][colIdx]) || 0; } touchDataUpdate(); return 0; }
function processPlanLogic(n, b) { const s = getSheetSafe('rencana'); const d = s.getDataRange().getValues(); for (let i = 1; i < d.length; i++) { if (String(d[i][1]).toUpperCase() === n) { if (String(d[i][2]).toUpperCase() === 'RUTIN') { s.getRange(i + 1, 5).setValue(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)); return { type: 'RUTIN', sisa: 0 }; } else { const sa = parseFloat(d[i][3]) || 0; const ns = sa - b; s.getRange(i + 1, 4).setValue(ns < 0 ? 0 : ns); s.getRange(i + 1, 5).setValue(new Date()); return { type: 'BUDGET', sisa: ns < 0 ? 0 : ns }; } } } touchDataUpdate(); return { type: 'UNKNOWN', sisa: 0 }; }
function getActivePlans() { const s = getSheetSafe('rencana'); if (!s || s.getLastRow() < 2) return []; const d = s.getDataRange().getValues(); d.shift(); const z = Session.getScriptTimeZone(); const t = Utilities.formatDate(new Date(), z, 'yyyyMM'); return d.filter(r => { const c = r[2] ? String(r[2]).toUpperCase().trim() : ""; if (c !== 'RUTIN') return true; try { return Utilities.formatDate(new Date(r[4]), z, 'yyyyMM') === t } catch (e) { return false } }).map(r => ({ id: r[0], name: r[1], category: r[2], amount: r[3], date: r[4] ? Utilities.formatDate(new Date(r[4]), z, 'yyyy-MM-dd') : '' })); }
function getActiveDebts(t) { const s = getSheetSafe('hutang'); const d = s.getDataRange().getValues(); d.shift(); touchDataUpdate(); return d.filter(r => r[1] === t && r[6] !== 'Lunas').map(r => ({ id: r[0], name: r[2], amount: r[5] })); }
function getSheetSafe(n) { const ss = SpreadsheetApp.getActiveSpreadsheet(); let s = ss.getSheetByName(n); if (!s) { s = ss.insertSheet(n); if (n === 'transaksi') s.appendRow(['ID', 'Kode', 'Kategori', 'Keterangan', 'Sumber', 'Nominal', 'Saldo Awal', 'Saldo Akhir', 'Tanggal']); } touchDataUpdate(); return s; }
function getAccountSources() { const ss = SpreadsheetApp.getActiveSpreadsheet(); let accounts = [];['bank', 'ewallet', 'tunai', 'investasi', 'tabungan'].forEach(type => { const sheet = ss.getSheetByName(type); if (sheet && sheet.getLastRow() > 1) { const data = sheet.getDataRange().getValues(); for (let i = 1; i < data.length; i++) { let idxSaldo = 2; if (type === 'investasi') idxSaldo = 3; if (type === 'tabungan') idxSaldo = 1; let idxNama = 1; if (type === 'tabungan') idxNama = 2; accounts.push({ type: type, id: data[i][0], name: data[i][idxNama], balance: parseFloat(data[i][idxSaldo]) || 0 }); } } }); return accounts; }
function getCategories() { const sheet = getSheetSafe('transaksi'); const data = sheet.getDataRange().getValues(); let cats = new Set(); for (let i = 1; i < data.length; i++) cats.add(data[i][1]); return Array.from(cats); }
/* --- CHART HISTORY (DIPERBAIKI) --- */
function getChartHistory() {
  const sheet = getSheetSafe('transaksi');
  const data = sheet.getDataRange().getValues();

  // Hapus baris header jika ada data
  if (data.length > 0) data.shift();

  const days = [], income = [], expense = [];
  const today = new Date();

  // Generate 30 hari terakhir
  for (let i = 7; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);

    // Format tanggal untuk perbandingan (yyyy-MM-dd)
    const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    // Format tanggal untuk label grafik (dd/MM)
    days.push(Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM'));

    let inc = 0, exp = 0;

    // Loop data transaksi
    data.forEach(row => {
      // row[8] adalah kolom Tanggal (Index 8 / Kolom I)
      if (row[8]) {
        const rowDate = Utilities.formatDate(new Date(row[8]), Session.getScriptTimeZone(), 'yyyy-MM-dd');

        if (rowDate === dateStr) {
          const nominal = parseFloat(row[5]) || 0; // row[5] adalah Nominal

          if (row[1] === 'PEMASUKAN') inc += nominal;
          if (row[1] === 'PENGELUARAN') exp += Math.abs(nominal);
        }
      }
    });

    income.push(inc);
    expense.push(exp);
  }
  touchDataUpdate();
  // Pastikan return selalu berbentuk object lengkap
  return { labels: days, income: income, expense: expense };
} function getReportChartData(start, end, category) { const sheet = getSheetSafe('transaksi'); const data = sheet.getDataRange().getValues(); data.shift(); const s = start ? new Date(start) : new Date(0); const e = end ? new Date(end) : new Date('3000-01-01'); if (start) s.setHours(0, 0, 0, 0); if (end) e.setHours(23, 59, 59, 999); const tz = Session.getScriptTimeZone(); let monthlyData = {}; let categoryData = {}; data.forEach(r => { const d = new Date(r[8]); let valid = d >= s && d <= e; if (category && category !== 'Semua') valid = valid && (r[1] === category); if (valid) { const nominal = parseFloat(r[5]) || 0; const absNominal = Math.abs(nominal); const monthLabel = Utilities.formatDate(d, tz, 'MMM yyyy'); if (!monthlyData[monthLabel]) monthlyData[monthLabel] = { in: 0, out: 0 }; if (r[1] === 'PEMASUKAN') monthlyData[monthLabel].in += nominal; if (r[1] === 'PENGELUARAN') monthlyData[monthLabel].out += absNominal; const kat = r[2] || 'Tanpa Kategori'; if (!categoryData[kat]) categoryData[kat] = 0; categoryData[kat] += absNominal; } }); const lineLabels = Object.keys(monthlyData); const lineIncome = lineLabels.map(k => monthlyData[k].in); const lineExpense = lineLabels.map(k => monthlyData[k].out); const sortedCats = Object.keys(categoryData).sort((a, b) => categoryData[b] - categoryData[a]); const pieLabels = sortedCats; const pieData = sortedCats.map(k => categoryData[k]); return { line: { labels: lineLabels, income: lineIncome, expense: lineExpense }, pie: { labels: pieLabels, data: pieData } }; }
function getTransactionData(start, end, category) { const sheet = getSheetSafe('transaksi'); if (sheet.getLastRow() < 2) return []; const data = sheet.getDataRange().getValues(); data.shift(); const s = start ? new Date(start) : new Date(0); const e = end ? new Date(end) : new Date('3000-01-01'); if (start) s.setHours(0, 0, 0, 0); if (end) e.setHours(23, 59, 59, 999); return data.filter(r => { const d = new Date(r[8]); let v = d >= s && d <= e; if (category && category !== 'Semua') v = v && (r[1] === category); return v; }).map(r => ({ kode: r[1], kategori: r[3], keterangan: r[4], nominal: r[5], tanggal: formatDate(r[8]) })).reverse(); }
function formatDate(d) { try { return d ? Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'dd/MM/yyyy') : '-' } catch (e) { return '-' } }
function formatRupiahSimple(n) { return new Intl.NumberFormat('id-ID').format(n); }

/* --- SISTEM AUTO RELOAD (TAMBAHAN) --- */

// 1. Fungsi untuk menandai bahwa ada data baru
function touchDataUpdate() {
  PropertiesService.getScriptProperties().setProperty('LAST_UPDATE', new Date().getTime().toString());
}

// 2. Fungsi untuk Frontend mengecek apakah ada update
function checkDataUpdate(clientTimestamp) {
  const serverTimestamp = PropertiesService.getScriptProperties().getProperty('LAST_UPDATE') || '0';
  // Jika timestamp server beda dengan klien, berarti ada data baru
  return { hasUpdate: serverTimestamp !== String(clientTimestamp), serverTimestamp: serverTimestamp };
}