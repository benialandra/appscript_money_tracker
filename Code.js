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
    allSheets.forEach(function(sheet) {
      var name = sheet.getName().toLowerCase().replace(/[^a-z]/g, ""); 
      var typeKey = null;

      if (name.includes("bank")) typeKey = 'banks';
      else if (name.includes("wallet") || name.includes("ewallet") || name.includes("dompet") || name.includes("gopay") || name.includes("ovo") || name.includes("shopee")) typeKey = 'wallets';
      else if (name.includes("tunai") || name.includes("cash") || name.includes("uang")) typeKey = 'cash';

      if (typeKey && sheet.getLastRow() > 1) {
        var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
        data.forEach(function(r) {
          if (r[0] && String(r[0]).trim() !== "") {
            var n = String(r[0]).trim(); 
            // Hapus Rp, Titik, Koma, Spasi -> Ambil Angka Saja
            var cleanVal = String(r[1]).replace(/[^0-9-]/g, ''); 
            var b = Number(cleanVal);
            if (isNaN(b)) b = 0;
            
            output.sources[typeKey].push({ name: n, startBalance: b });
            output.balances[n] = b;
          }
        });
      }
    });

    // AMBIL BUDGET
    var shP = getSheetByLooseName(ss, "rencana");
    if (shP && shP.getLastRow() > 1) {
      var pData = shP.getRange(2, 1, shP.getLastRow() - 1, 5).getValues();
      output.plans = pData.map(function(r, i) {
        return { 
          row: i + 2, name: String(r[0]), 
          amount: Number(String(r[1]).replace(/[^0-9-]/g,''))||0, 
          date: String(r[2]), status: String(r[3]), desc: String(r[4]) 
        };
      }).filter(function(p){ return p.name && p.status !== 'Lunas' });
    }

    // AMBIL MUTASI
    var shM = getSheetByLooseName(ss, "mutasi");
    if (shM && shM.getLastRow() > 1) {
      var mData = shM.getRange(2, 1, shM.getLastRow() - 1, 7).getValues();
      output.history = mData.map(function(r) {
        return { 
          date: String(r[0]), type: String(r[1]), cat: String(r[2]), 
          amount: Number(String(r[3]).replace(/[^0-9-]/g,''))||0, 
          acc: String(r[4]), dest: String(r[5]), note: String(r[6]) 
        };
      });
      output.history.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    }

  } catch (e) { Logger.log("Error: " + e.message); }
  return output;
}

/* --- HELPER --- */
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
    if(n.includes("bank") || n.includes("wallet") || n.includes("tunai")) {
       var data = sh.getDataRange().getValues();
       for(var j=1; j<data.length; j++) {
         if(String(data[j][0]) === namaAkun) {
           var cleanVal = Number(String(data[j][1]).replace(/[^0-9-]/g,'')) || 0;
           sh.getRange(j+1, 2).setValue(cleanVal + selisih);
           return;
         }
       }
    }
  }
}
function tambahRencana(nama, nominal, tgl, ket) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getSheetOrMake(ss, "rencana", ["Nama", "Nominal", "Tanggal", "Status", "Keterangan"]);
  sheet.appendRow([nama, Number(nominal), new Date(tgl), "Pending", ket]);
  return "Sukses";
}
// function updateStatusRencana(row) {
//   var ss = SpreadsheetApp.getActiveSpreadsheet();
//   var sh = getSheetByLooseName(ss, "rencana");
//   if(sh) sh.getRange(row, 4).setValue("Lunas");
// }

function bayarRencana(row, namaRencana, nominal, akunSumber) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tgl = new Date(); // Tanggal hari ini
  
  try {
    // 1. UPDATE STATUS RENCANA JADI "LUNAS"
    var shPlan = getSheetByLooseName(ss, "rencana");
    if (shPlan) {
      // Kolom 4 adalah Status
      shPlan.getRange(row, 4).setValue("Lunas"); 
    }

    // 2. CATAT KE MUTASI (Sebagai Pengeluaran)
    var shMutasi = getSheetOrMake(ss, "Mutasi", ["Tanggal", "Tipe", "Kategori", "Nominal", "Akun Sumber", "Akun Tujuan", "Ket"]);
    // Format: Tanggal, Expense, Pelunasan Rencana, Nominal, Sumber, -, Ket
    shMutasi.appendRow([tgl, "Expense", "Pelunasan Rencana", Number(nominal), akunSumber, "-", "LUNAS: " + namaRencana]);

    // 3. POTONG SALDO AKUN SUMBER
    updateSaldoAkun(ss, akunSumber, -Number(nominal));

    return "Sukses";
  } catch (e) {
    return "Error: " + e.message;
  }
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
  for(var i=0; i<allSheets.length; i++) {
     var sh = allSheets[i];
     var n = sh.getName().toLowerCase();
     if(n.includes("bank") || n.includes("wallet") || n.includes("tunai")) {
       var d = sh.getDataRange().getValues();
       for(var j=1; j<d.length; j++) {
         if(String(d[j][0]) === accountName) { sh.getRange(j+1, 2).setValue(newAmount); return; }
       }
     }
  }
}
function loginUser(u, p) {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("user");
  if(!s) return {success:false, message:"Sheet user hilang"};
  var d = s.getDataRange().getValues();
  for(var i=1; i<d.length; i++) if(String(d[i][0]).toLowerCase()==u.toLowerCase() && String(d[i][1])==p) return {success:true};
  return {success:false, message:"Salah"};
}
function updateUserProfile(username, oldPass, newPass) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("user");
  var d = sh.getDataRange().getValues();
  for(var i=1; i<d.length; i++) {
    if(String(d[i][0])==username && String(d[i][1])==oldPass) {
      sh.getRange(i+1,2).setValue(newPass);
      return {success:true};
    }
  }
  return {success:false, message:"Password Lama Salah"};
}