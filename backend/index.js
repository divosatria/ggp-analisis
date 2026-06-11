const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Konfigurasi Socket.IO untuk mengizinkan frontend terhubung
const io = new Server(server, {
  cors: {
    origin: "*", // Izinkan semua origin untuk development
    methods: ["GET", "POST"]
  }
});

// ========================
// SQLite Database Setup
// ========================
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}
const dbPath = path.join(dataDir, 'telemetry.db');
const db = new Database(dbPath);

// Aktifkan WAL mode untuk performa yang lebih baik
db.pragma('journal_mode = WAL');

// Buat tabel jika belum ada
db.exec(`
  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    device_id TEXT,
    timestamp TEXT,
    lat REAL,
    lon REAL,
    alt REAL,
    sog REAL,
    cog REAL,
    dist1 REAL,
    dist2 REAL,
    debit1 REAL,
    debit2 REAL,
    total1 REAL,
    total2 REAL,
    konsumsi REAL,
    tinggi_bbm REAL,
    tekanan_bbm REAL,
    suhu_mesin REAL,
    voltage REAL,
    current_a REAL,
    power_w REAL,
    suhu_udara REAL,
    humidity REAL,
    tekanan_udara REAL,
    imu_x REAL,
    imu_y REAL,
    imu_z REAL,
    raw_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Tambahkan kolom type jika sebelumnya database sudah terlanjur dibuat tanpa type
try {
  db.exec('ALTER TABLE telemetry ADD COLUMN type TEXT;');
} catch (e) {
  // Abaikan error jika kolom sudah ada
}

// Index pada timestamp untuk query cepat
db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_device ON telemetry(device_id)`);

console.log(`Database SQLite siap di: ${dbPath}`);

// Prepared statement untuk INSERT (lebih cepat)
const insertStmt = db.prepare(`
  INSERT INTO telemetry (
    type, device_id, timestamp,
    lat, lon, alt, sog, cog,
    dist1, dist2,
    debit1, debit2, total1, total2, konsumsi,
    tinggi_bbm, tekanan_bbm,
    suhu_mesin,
    voltage, current_a, power_w,
    suhu_udara, humidity, tekanan_udara,
    imu_x, imu_y, imu_z,
    raw_json
  ) VALUES (
    @type, @device_id, @timestamp,
    @lat, @lon, @alt, @sog, @cog,
    @dist1, @dist2,
    @debit1, @debit2, @total1, @total2, @konsumsi,
    @tinggi_bbm, @tekanan_bbm,
    @suhu_mesin,
    @voltage, @current_a, @power_w,
    @suhu_udara, @humidity, @tekanan_udara,
    @imu_x, @imu_y, @imu_z,
    @raw_json
  )
`);

// Fungsi untuk menyimpan data telemetry ke database
function saveTelemetry(payload) {
  try {
    insertStmt.run({
      type: payload.type || null,
      device_id: payload.deviceId || null,
      timestamp: payload.timestamp || new Date().toISOString(),
      lat: payload.gps?.lat ?? null,
      lon: payload.gps?.lon ?? null,
      alt: payload.gps?.alt ?? null,
      sog: payload.gps?.sog ?? null,
      cog: payload.gps?.cog ?? null,
      dist1: payload.ultrasonic?.dist1 ?? null,
      dist2: payload.ultrasonic?.dist2 ?? null,
      debit1: payload.flowmeter?.debit1 ?? null,
      debit2: payload.flowmeter?.debit2 ?? null,
      total1: payload.flowmeter?.total1 ?? null,
      total2: payload.flowmeter?.total2 ?? null,
      konsumsi: payload.flowmeter?.konsumsi ?? null,
      tinggi_bbm: payload.bbm?.tinggi_bbm ?? null,
      tekanan_bbm: payload.bbm?.tekanan_bbm ?? null,
      suhu_mesin: payload.engine?.suhu_mesin ?? null,
      voltage: payload.power?.v ?? null,
      current_a: payload.power?.i ?? null,
      power_w: payload.power?.p ?? null,
      suhu_udara: payload.environment?.suhu_udara ?? null,
      humidity: payload.environment?.hum ?? null,
      tekanan_udara: payload.environment?.tek ?? null,
      imu_x: payload.imu?.x ?? null,
      imu_y: payload.imu?.y ?? null,
      imu_z: payload.imu?.z ?? null,
      raw_json: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Gagal menyimpan ke database:', err.message);
  }
}

// ========================
// REST API Endpoints
// ========================

// GET /api/history?limit=100&offset=0 — Ambil data terbaru
app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const offset = parseInt(req.query.offset) || 0;
  const rows = db.prepare('SELECT * FROM telemetry ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM telemetry').get();
  res.json({ data: rows.reverse(), total: total.count });
});

// GET /api/export — Ekspor semua data ke CSV (Mendukung filter waktu)
app.get('/api/export', (req, res) => {
  const { from, to } = req.query;
  let rows = [];
  
  if (from && to) {
    rows = db.prepare('SELECT * FROM telemetry WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(from, to);
  } else {
    rows = db.prepare('SELECT * FROM telemetry ORDER BY id ASC').all();
  }
  
  if (rows.length === 0) {
    return res.status(404).send('Tidak ada data untuk diekspor');
  }

  // Buat header CSV berdasarkan key di objek pertama (kecuali raw_json agar tidak berantakan)
  const columns = Object.keys(rows[0]).filter(col => col !== 'raw_json');
  const csvHeader = columns.join(',') + '\n';
  
  const csvRows = rows.map(row => {
    return columns.map(col => {
      let val = row[col];
      if (val === null || val === undefined) return '';
      // Jika string mengandung koma, bungkus dengan tanda kutip
      if (typeof val === 'string' && val.includes(',')) {
        return `"${val}"`;
      }
      return val;
    }).join(',');
  }).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=telemetry_export.csv');
  res.send(csvHeader + csvRows);
});

// GET /api/history/range?from=2026-06-01&to=2026-06-10 — Ambil data berdasarkan rentang waktu
app.get('/api/history/range', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'Parameter "from" dan "to" wajib diisi' });
  }
  const rows = db.prepare('SELECT * FROM telemetry WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC').all(from, to);
  res.json({ data: rows, total: rows.length });
});

// GET /api/stats — Statistik ringkas database
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM telemetry').get();
  const latest = db.prepare('SELECT timestamp FROM telemetry ORDER BY id DESC LIMIT 1').get();
  const oldest = db.prepare('SELECT timestamp FROM telemetry ORDER BY id ASC LIMIT 1').get();
  res.json({
    total_records: total.count,
    latest_record: latest?.timestamp || null,
    oldest_record: oldest?.timestamp || null
  });
});

// ========================
// MQTT Connection
// ========================
const MQTT_BROKER = "mqtt://13.228.132.8:1883";
const MQTT_TOPIC = "ggf/subsoil/batch";

console.log(`Connecting to MQTT Broker at ${MQTT_BROKER}...`);

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: `ggp_backend_${Math.random().toString(16).substring(2, 8)}`,
  reconnectPeriod: 5000,
});

mqttClient.on('connect', () => {
  console.log("Terhubung ke MQTT Broker secara langsung (TCP 1883)!");
  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (!err) {
      console.log(`Berhasil subscribe ke topic: ${MQTT_TOPIC}`);
    } else {
      console.error("Gagal subscribe:", err);
    }
  });
});

mqttClient.on('error', (err) => {
  console.error("MQTT Error:", err);
});

// Event saat data diterima dari MQTT
mqttClient.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    console.log(`[MQTT IN] Menerima data dari ${topic}:`, payload.deviceId || "Unknown");
    
    // Simpan ke database SQLite
    saveTelemetry(payload);
    
    // Broadcast / teruskan data tersebut ke semua client web yang terhubung
    io.emit('telemetry_data', payload);
    
  } catch (error) {
    console.error("Gagal memproses pesan MQTT:", error);
  }
});

io.on('connection', (socket) => {
  console.log('Web Client terhubung:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Web Client terputus:', socket.id);
  });
});

// Graceful shutdown — tutup database saat server mati
process.on('SIGINT', () => {
  console.log('\nMenutup database...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  db.close();
  process.exit(0);
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Backend Server berjalan di http://localhost:${PORT}`);
  console.log(`API History: http://localhost:${PORT}/api/history`);
  console.log(`API Stats:   http://localhost:${PORT}/api/stats`);
});
