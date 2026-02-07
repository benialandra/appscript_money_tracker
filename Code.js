function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate().setTitle('Isi Dompet').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) { return HtmlService.createTemplateFromFile(filename).getRawContent(); }

/* --- GET DATA (PARSING ANGKA KUAT) --- */
function getInitData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var output = { sources: { banks: [], wallets: [], cash: [] }, balances: {}, plans: [], history: [] };

  try {
    var allSheets = ss.getSheets();
    allSheets.forEach(function (sheet) {
      var name = sheet.getName().toLowerCase().replace(/[^a-z]/g, "");
      var typeKey = null;

      if (name.includes("bank")) typeKey = 'banks';
      else if (name.includes("wallet") || name.includes("ewallet") || name.includes("dompet") || name.includes("gopay") || name.includes("ovo") || name.includes("shopee")) typeKey = 'wallets';
      else if (name.includes("tunai") || name.includes("cash") || name.includes("uang")) typeKey = 'cash';

      // Pastikan ada data (Lebih dari 1 baris)
      if (typeKey && sheet.getLastRow() > 1) {
        // Ambil 2 Kolom Saja (A & B)
        var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
        data.forEach(function (r) {
          if (r[0] && String(r[0]).trim() !== "") {
            var n = String(r[0]).trim();
            // Ambil Saldo dari Kolom Index 1 (Kolom B)
            var cleanVal = String(r[1]).replace(/[^0-9-]/g, '');
            var b = Number(cleanVal);
            if (isNaN(b)) b = 0;

            output.sources[typeKey].push({ name: n, startBalance: b });
            output.balances[n] = b;
          }
        });
      }
    });

    // AMBIL BUDGET (Sheet: rencana)
    var shP = getSheetByLooseName(ss, "rencana");
    if (shP && shP.getLastRow() > 1) {
      // Asumsi: Nama(A), Nominal(B), Tanggal(C), Status(D), Ket(E)
      var pData = shP.getRange(2, 1, shP.getLastRow() - 1, 5).getValues();
      output.plans = pData.map(function (r, i) {
        return {
          row: i + 2, // Baris Excel
          name: String(r[0]),
          amount: Number(String(r[1]).replace(/[^0-9-]/g, '')) || 0, // Nominal di Kolom B
          date: String(r[2]),
          status: String(r[3]),
          desc: String(r[4])
        };
      }).filter(function (p) { return p.name && p.status !== 'Lunas' });
    }

    // AMBIL MUTASI (Sheet: Mutasi)
    var shM = getSheetByLooseName(ss, "mutasi");
    if (shM && shM.getLastRow() > 1) {
      // Format: Tgl(A), Tipe(B), Kat(C), Nominal(D), Akun(E), Tujuan(F), Ket(G)
      var mData = shM.getRange(2, 1, shM.getLastRow() - 1, 7).getValues();
      output.history = mData.map(function (r) {
        return {
          date: String(r[0]),
          type: String(r[1]),
          cat: String(r[2]),
          amount: Number(String(r[3]).replace(/[^0-9-]/g, '')) || 0,
          acc: String(r[4]),
          dest: String(r[5]),
          note: String(r[6])
        };
      });
      output.history.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    }
    const getHistory = () => {
      if (!sheetTrans) return [];
      const lastRow = sheetTrans.getLastRow();
      if (lastRow < 2) return [];

      // Ambil SEMUA data dari baris 2 sampai akhir
      // Logika sort reverse (terbaru diatas) tetap dilakukan
      const raw = sheetTrans.getRange(2, 1, lastRow - 1, 7).getValues();

      let hist = raw.map(r => ({
        date: r[0],
        type: r[1],
        cat: r[2],
        note: r[3] || r[6], // Handle kolom lama/baru (Note ada di col D atau G)
        amount: Number(r[4] || r[3]) || 0, // Handle posisi kolom nominal
        acc: r[5],
        dest: r[6]
      }));

      // Sort Descending (Terbaru paling atas)
      return hist.sort((a, b) => new Date(b.date) - new Date(a.date));
    };

  } catch (e) { Logger.log("Error: " + e.message); }
  return output;
}

/* --- FUNCTION PENTING: BAYAR RENCANA (FIXED) --- */
function bayarRencana(row, namaRencana, nominalRencana, nominalBayar, akunSumber) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheetNamePlans = "rencana";
  const sheetNameTrans = "Mutasi";
  const sheetNameBank = "Bank";
  const sheetNameWallet = "ewallet";
  const sheetNameCash = "Tunai";

  const planSheet = ss.getSheetByName(sheetNamePlans);
  const transSheet = ss.getSheetByName(sheetNameTrans);
  const bankSheet = ss.getSheetByName(sheetNameBank);
  const walletSheet = ss.getSheetByName(sheetNameWallet);
  const cashSheet = ss.getSheetByName(sheetNameCash);

  if (!planSheet) throw new Error(`Sheet "${sheetNamePlans}" tidak ditemukan.`);
  if (!transSheet) throw new Error(`Sheet "${sheetNameTrans}" tidak ditemukan.`);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    // 1. CARI DAN POTONG SALDO
    let akunDitemukan = false;

    // Fungsi pencari (Helper)
    const cariDiSheet = (sheet) => {
      if (!sheet) return { found: false };
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        // Cek Nama di Kolom A (Index 0)
        if (String(data[i][0]).trim() === String(akunSumber).trim()) {
          // FIX DISINI: Saldo ada di Kolom B (Index 1), BUKAN Index 2
          return { found: true, sheet: sheet, row: i + 1, saldo: Number(data[i][1]) };
        }
      }
      return { found: false };
    };

    // Cek berurutan
    let result = cariDiSheet(bankSheet);
    if (!result.found) result = cariDiSheet(walletSheet);
    if (!result.found) result = cariDiSheet(cashSheet);

    if (result.found) {
      // Update Saldo di Kolom B (Angka 2)
      result.sheet.getRange(result.row, 2).setValue(result.saldo - Number(nominalBayar));
    } else {
      throw new Error(`Akun "${akunSumber}" tidak ditemukan.`);
    }

    // 2. CATAT MUTASI
    // Format: [Tanggal, Tipe, Kategori, Nominal, Akun, Tujuan, Ket]
    // Sesuai dengan pembacaan di getInitData
    transSheet.appendRow([
      new Date(),
      "Expense",
      "Pelunasan Rencana",
      Number(nominalBayar), // Nominal (Kolom D)
      akunSumber,           // Akun (Kolom E)
      '-',                  // Tujuan (Kolom F)
      "PEMBAYARAN: " + namaRencana // Keterangan (Kolom G)
    ]);

    // 3. UPDATE RENCANA (SISA TAGIHAN)
    if (row > 0) {
      let rencanaAwal = Number(nominalRencana);
      let bayarReal = Number(nominalBayar);

      if (bayarReal < rencanaAwal) {
        // PARTIAL: Kurangi Sisa Tagihan (Kolom B / Index 2 di Sheet Rencana)
        let sisa = rencanaAwal - bayarReal;
        planSheet.getRange(row, 2).setValue(sisa);
      } else {
        // FULL: Status jadi Lunas (Kolom D / Index 4 di Sheet Rencana)
        planSheet.getRange(row, 4).setValue("Lunas");
      }
    }

  } catch (e) {
    throw e;
  } finally {
    lock.releaseLock();
  }

  return { success: true };
}

/* --- HELPER & FUNGSI LAIN --- */
function getSheetByLooseName(ss, name) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === name.toLowerCase()) return sheets[i];
  }
  return null;
}

function getSheetOrMake(ss, name, header) {
  var sh = getSheetByLooseName(ss, name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); }
  return sh;
}

function simpanData(form) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Pastikan sheet Mutasi ada
  var sheet = getSheetOrMake(ss, "Mutasi", ["Tanggal", "Tipe", "Kategori", "Nominal", "Akun Sumber", "Akun Tujuan", "Ket"]);

  var tgl = new Date(form.tanggal);
  var nominal = Number(String(form.jumlah).replace(/\./g, "").replace(/,/g, ""));
  var ket = (form.keterangan || "").toUpperCase();

  if (form.mode === 'transfer') {
    sheet.appendRow([tgl, "Transfer", "Pindah Dana", nominal, form.sumber_tf, form.tujuan_tf, ket]);
    updateSaldoAkun(ss, form.sumber_tf, -nominal);
    updateSaldoAkun(ss, form.tujuan_tf, nominal);
  } else {
    var faktor = (form.tipe === 'Expense') ? -1 : 1;
    sheet.appendRow([tgl, form.tipe, form.kategori, nominal, form.sumber, "-", ket]);
    updateSaldoAkun(ss, form.sumber, nominal * faktor);
  }
  return "Sukses";
}

function updateSaldoAkun(ss, namaAkun, selisih) {
  var allSheets = ss.getSheets();
  for (var i = 0; i < allSheets.length; i++) {
    var sh = allSheets[i];
    var n = sh.getName().toLowerCase();
    // Cek di sheet Bank, Wallet, Tunai
    if (n.includes("bank") || n.includes("wallet") || n.includes("tunai")) {
      var data = sh.getDataRange().getValues();
      for (var j = 1; j < data.length; j++) {
        if (String(data[j][0]) === namaAkun) {
          // FIX: Ambil Saldo dari Index 1 (Kolom B)
          var cleanVal = Number(String(data[j][1]).replace(/[^0-9-]/g, '')) || 0;
          // FIX: Update ke Kolom 2 (Kolom B)
          sh.getRange(j + 1, 2).setValue(cleanVal + selisih);
          return;
        }
      }
    }
  }
}
/* --- UPDATE RENCANA --- */
function updateRencana(row, nama, nominal, tgl, ket) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("rencana");

  // Update Data (Kolom A, B, C, E)
  sheet.getRange(row, 1).setValue(nama);              // Nama
  sheet.getRange(row, 2).setValue(Number(nominal));   // Nominal
  sheet.getRange(row, 3).setValue(new Date(tgl));     // Tanggal
  sheet.getRange(row, 5).setValue(ket);               // Keterangan

  // Logika Cerdas: 
  // Jika nominal diupdate jadi > 0, otomatis set status jadi "Pending" lagi
  // Ini berguna kalau Bapak mau "Top Up" rencana yang sudah lunas.
  if (Number(nominal) > 0) {
    sheet.getRange(row, 4).setValue("Pending");
  }

  return { success: true };
}
function tambahRencana(nama, nominal, tgl, ket) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetOrMake(ss, "rencana", ["Nama", "Nominal", "Tanggal", "Status", "Keterangan"]);
  // Kolom: Nama(A), Nominal(B), Tanggal(C), Status(D), Keterangan(E)
  sheet.appendRow([nama, Number(nominal), new Date(tgl), "Pending", ket]);
  return "Sukses";
}

function tambahAkunBaru(nama, tipe, saldo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var target = (tipe === "Bank") ? "Bank" : (tipe === "E-Wallet" ? "ewallet" : "Tunai");
  var sheet = getSheetOrMake(ss, target, ["Nama Akun", "Saldo"]);
  sheet.appendRow([nama, saldo]);
}

function updateSaldoAwal(accountName, newAmount) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allSheets = ss.getSheets();
  for (var i = 0; i < allSheets.length; i++) {
    var sh = allSheets[i];
    var n = sh.getName().toLowerCase();
    if (n.includes("bank") || n.includes("wallet") || n.includes("tunai")) {
      var d = sh.getDataRange().getValues();
      for (var j = 1; j < d.length; j++) {
        if (String(d[j][0]) === accountName) {
          // FIX: Update ke Kolom 2
          sh.getRange(j + 1, 2).setValue(newAmount);
          return;
        }
      }
    }
  }
}

/* --- FITUR FORGOT PASSWORD --- */
function processForgotPassword(username, email) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("user");

    if (!sheet) return { success: false, message: "Database user tidak ditemukan." };

    var data = sheet.getDataRange().getValues();
    var found = false;
    var userPass = "";

    // Loop cari Username & Email yang cocok
    for (var i = 1; i < data.length; i++) {
      var dbUser = String(data[i][0]).trim().toLowerCase(); // Kolom A
      var dbPass = data[i][1];                              // Kolom B
      var dbEmail = String(data[i][2]).trim().toLowerCase();// Kolom C

      if (dbUser === String(username).trim().toLowerCase() &&
        dbEmail === String(email).trim().toLowerCase()) {
        userPass = dbPass;
        found = true;
        break;
      }
    }

    if (found) {
      // Kirim Email
      var subject = "Recovery Password - Isi Dompet";
      var body = "Halo " + username + ",\n\n" +
        "Permintaan pemulihan password Anda telah diterima.\n" +
        "Password Anda adalah: " + userPass + "\n\n" +
        "Silakan login kembali dan segera ganti password jika perlu.\n\n" +
        "- Admin Isi Dompet";

      MailApp.sendEmail(email, subject, body);
      return { success: true, message: "Password telah dikirim ke email Anda." };
    } else {
      return { success: false, message: "Kombinasi Username & Email tidak ditemukan." };
    }

  } catch (e) {
    return { success: false, message: "Error: " + e.message };
  }
}

function loginUser(u, p) {
  try {
    // 1. SIAPKAN DEFAULT (Dari Properties atau Hardcode)
    var props = PropertiesService.getScriptProperties();
    var savedU = props.getProperty('username') || 'admin';
    var savedP = props.getProperty('password') || '12345';

    // Bersihkan input user (hapus spasi depan/belakang)
    var inputU = String(u).trim();
    var inputP = String(p).trim();

  // 2. CEK VIA SHEET 'user' (OPSIONAL - PRIORITAS UTAMA)
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("user");
    if (s) {
      var d = s.getDataRange().getValues();
      // Loop dari baris ke-2 (index 1), asumsi baris 1 adalah Header
      for (var i = 1; i < d.length; i++) {
        // Kolom A = Username, Kolom B = Password
        var sheetUser = String(d[i][0]).trim();
        var sheetPass = String(d[i][1]).trim();

        if (sheetUser.toLowerCase() === inputU.toLowerCase() && sheetPass === inputP) {
          return { success: true };
        }
      }
    }

    // 3. CEK VIA DEFAULT (FALLBACK)
    // Perbaikan: Pakai variabel savedU/savedP, jangan hardcode lagi
    if (inputU.toLowerCase() === savedU.toLowerCase() && inputP === savedP) {
      return { success: true };
    }

    // 4. JIKA SEMUA GAGAL
    return { success: false, message: "Username atau Password Salah!" };

  } catch (e) {
    return { success: false, message: "Error Server: " + e.message };
  }
}

function updateUserProfile(username, oldPass, newPass) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("user");
  if (sh) {
    var d = sh.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      if (String(d[i][0]) == username && String(d[i][1]) == oldPass) {
        sh.getRange(i + 1, 2).setValue(newPass);
        return { success: true };
      }
    }
  }
  return { success: false, message: "Gagal update profile" };
}