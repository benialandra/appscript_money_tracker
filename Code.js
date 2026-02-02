function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Isi Dompet')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* --- 1. GET DATA (VERSI BARU: LEBIH RINGAN) --- */
function getInitData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // A. AMBIL SALDO (LANGSUNG BACA, TIDAK PERLU HITUNG ULANG)
  // Karena saldo di sheet sekarang adalah Saldo Real-time.
  var sources = { banks: [], wallets: [], cash: [] };
  var balances = {};

  function readAccountSheet(sheetName, typeKey) {
    var sheet = ss.getSheetByName(sheetName);
    if (sheet && sheet.getLastRow() > 1) {
      var raw = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
      raw.forEach(function (r) {
        if (r[0]) {
          var name = String(r[0]);
          var currentBal = Number(r[1]) || 0; // Ini sekarang dianggap Saldo SAAT INI
          sources[typeKey].push({ name: name, startBalance: currentBal });
          balances[name] = currentBal;
        }
      });
    }
  }

  readAccountSheet("Bank", "banks");
  readAccountSheet("ewallet", "wallets");
  readAccountSheet("Tunai", "cash");

  // B. AMBIL TRANSAKSI (Hanya untuk keperluan Grafik & Tabel)
  var sheetTrans = ss.getSheetByName("Transactions");
  var transactions = [];

  if (sheetTrans && sheetTrans.getLastRow() > 1) {
    // Ambil maksimal 500 transaksi terakhir saja biar makin ngebut (Opsional)
    // var startRow = Math.max(2, sheetTrans.getLastRow() - 500);
    // var numRows = sheetTrans.getLastRow() - startRow + 1;
    var rawTrans = sheetTrans.getRange(2, 1, sheetTrans.getLastRow() - 1, 11).getValues();

    // Reverse Loop (Dari bawah ke atas) biar data terbaru duluan
    for (var i = rawTrans.length - 1; i >= 0; i--) {
      var r = rawTrans[i];
      var tgl = new Date(r[0]);

      transactions.push({
        date: (tgl instanceof Date && !isNaN(tgl)) ? tgl.toISOString() : new Date().toISOString(),
        type: String(r[1] || ""),
        category: String(r[2] || ""),
        amount: Number(r[3]) || 0,
        desc: String(r[4] || ""),
        source: String(r[5] || "")
      });
    }
  }

  // Kirim ke Frontend
  return {
    transactions: transactions, // Data history
    sources: sources,           // List akun
    finalBalances: balances     // Saldo Matang (dari Sheet)
  };
}

/* --- 2. SIMPAN DATA + UPDATE SALDO OTOMATIS --- */
function simpanData(form) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var sheet = ss.getSheetByName("Transactions");
    var tgl = new Date(form.tanggal);
    var jumlah = Number(String(form.jumlah).replace(/\./g, "").replace(/,/g, ""));

    // --- CEK MODE INPUT ---
    if (form.mode === 'transfer') {

      // LOGIKA TRANSFER
      if (form.sumber_tf === form.tujuan_tf) throw new Error("Akun Asal & Tujuan tidak boleh sama!");

      // 1. Catat di History (1 Baris saja biar rapi)
      // Format: Tipe="Transfer", Kategori="Pindah Dana", Desc="Transfer ke [Tujuan] : [Ket]"
      var desc = "Transfer ke " + form.tujuan_tf + " : " + form.keterangan;
      sheet.appendRow([tgl, "Transfer", "Pindah Dana", jumlah, desc, form.sumber_tf]);

      // 2. Kurangi Saldo Pengirim
      updateSheetBalance(ss, form.sumber_tf, jumlah, 'Expense');

      // 3. Tambah Saldo Penerima
      updateSheetBalance(ss, form.tujuan_tf, jumlah, 'Income');

    } else {

      // LOGIKA TRANSAKSI BIASA (Lama)
      if (!form.tipe || !form.sumber) throw new Error("Lengkapi data!");
      sheet.appendRow([tgl, form.tipe, form.kategori, jumlah, form.keterangan, form.sumber]);
      updateSheetBalance(ss, form.sumber, jumlah, form.tipe);

    }

    return "Sukses";
  } catch (e) {
    throw new Error(e.message);
  } finally {
    lock.releaseLock();
  }
}
// --- HELPER: UPDATE SALDO FISIK ---
function updateSheetBalance(ss, accountName, amount, type) {
  var targetSheets = ["Bank", "ewallet", "Tunai"];

  for (var i = 0; i < targetSheets.length; i++) {
    var sheet = ss.getSheetByName(targetSheets[i]);
    if (!sheet) continue;

    var data = sheet.getDataRange().getValues();
    // Loop cari nama akun
    for (var r = 1; r < data.length; r++) { // Mulai baris 2 (index 1)
      if (String(data[r][0]) === accountName) {
        var currentSaldo = Number(data[r][1]) || 0;

        // LOGIKA MATEMATIKA
        var newSaldo = 0;
        if (type === 'Income') {
          newSaldo = currentSaldo + amount;
        } else {
          newSaldo = currentSaldo - amount;
        }

        // Tulis balik ke Sheet (Kolom B / Index 2)
        sheet.getRange(r + 1, 2).setValue(newSaldo);
        return; // Selesai, keluar fungsi
      }
    }
  }
}

/* --- 3. FITUR LAIN (LOGIN & PROFILE) --- */
function loginUser(username, password) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("user");
  if (!sheet) return { success: false, message: "Sheet 'user' missing!" };
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === username && String(data[i][1]) === password) {
      return { success: true, message: "Login OK" };
    }
  }
  return { success: false, message: "User/Pass Salah" };
}

function updateUserProfile(oldUser, oldPass, newUser, newPass) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("user");
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === oldUser && String(data[i][1]) === oldPass) {
      sheet.getRange(i + 2, 1).setValue(newUser);
      sheet.getRange(i + 2, 2).setValue(newPass);
      return { success: true, message: "Profile Updated" };
    }
  }
  return { success: false, message: "Password Lama Salah" };
}

// Fungsi Update Manual (Menu Saldo) - Tetap berguna untuk koreksi
function updateSaldoAwal(accountName, newAmount) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var updated = false;
  // Fungsi helper kecil untuk update manual
  function setVal(sName) {
    var sh = ss.getSheetByName(sName);
    var d = sh.getDataRange().getValues();
    for (var j = 1; j < d.length; j++) {
      if (String(d[j][0]) === accountName) {
        sh.getRange(j + 1, 2).setValue(newAmount);
        return true;
      }
    }
    return false;
  }

  if (setVal("Bank")) return "Bank Updated";
  if (setVal("ewallet")) return "Wallet Updated";
  if (setVal("Tunai")) return "Cash Updated";

  throw new Error("Akun tidak ditemukan");
}
/* --- TAMBAHKAN DI Code.gs --- */

function tambahAkunBaru(nama, tipe, saldoAwal) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = "";
  
  // Tentukan Sheet Tujuan
  if (tipe === "Bank") sheetName = "Bank";
  else if (tipe === "E-Wallet") sheetName = "ewallet";
  else if (tipe === "Tunai") sheetName = "Tunai";
  else throw new Error("Tipe akun tidak valid!");

  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet " + sheetName + " tidak ditemukan!");

  // Cek Duplikat Nama (Biar gak double)
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === nama.toLowerCase()) {
      throw new Error("Akun '" + nama + "' sudah ada!");
    }
  }

  // Tambahkan Baris Baru
  sheet.appendRow([nama, saldoAwal]);
  
  return "Berhasil menambahkan " + nama;
}