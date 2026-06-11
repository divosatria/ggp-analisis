import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Activity, Navigation, Thermometer, Droplets, Battery, Waves, Cpu, Zap, Cloud, Compass, Download, Clock, Search } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TelemetryData } from './types';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const bulldozerIcon = L.icon({
  iconUrl: '/bulldozer.png',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});
L.Marker.prototype.options.icon = bulldozerIcon;

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

const MetricBox = ({ label, value, unit }: { label: string, value: number | string | undefined, unit?: string }) => (
  <div className="flex justify-between items-end border-b border-slate-100 pb-2">
    <span className="text-slate-500 text-sm">{label}</span>
    <span className="font-mono text-lg text-slate-800">
      {value !== undefined ? value : '--'}
      {value !== undefined && unit && <span className="text-sm text-slate-400 ml-1">{unit}</span>}
    </span>
  </div>
);

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [currentData, setCurrentData] = useState<TelemetryData | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  const [viewMode, setViewMode] = useState<'realtime' | 'history'>('realtime');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historicalPath, setHistoricalPath] = useState<[number, number][]>([]);
  const [realtimePath, setRealtimePath] = useState<[number, number][]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>('');
  const [availableDevices, setAvailableDevices] = useState<string[]>([]);
  const viewModeRef = useRef(viewMode);
  const lastUpdateRef = useRef<number>(Date.now());
  
  useEffect(() => {
    viewModeRef.current = viewMode;
    // Bersihkan data grafik jika beralih mode
    if (viewMode === 'history') {
      setHistoryData([]);
      setHistoricalPath([]);
    }
  }, [viewMode]);

  useEffect(() => {
    // Bersihkan grafik saat pindah device di realtime mode
    if (viewMode === 'realtime') setHistoryData([]);
  }, [activeDeviceId, viewMode]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleExportCSV = () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://103.217.145.187:4001';
    if (viewMode === 'history' && fromDate && toDate) {
      window.open(`${backendUrl}/api/export?from=${new Date(fromDate).toISOString()}&to=${new Date(toDate).toISOString()}`, '_blank');
    } else {
      window.open(`${backendUrl}/api/export`, '_blank');
    }
  };

  const fetchHistory = async () => {
    if (!fromDate || !toDate) {
      alert('Silakan pilih rentang tanggal (Mulai dan Selesai)');
      return;
    }
    setIsLoadingHistory(true);
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://103.217.145.187:4001';
      // Kembalikan ke format ISO UTC karena live server ternyata menyimpannya dalam UTC
      const fromISO = new Date(fromDate).toISOString();
      const toISO = new Date(toDate).toISOString();
      const res = await fetch(`${backendUrl}/api/history/range?from=${fromISO}&to=${toISO}`);
      const result = await res.json();
      
      if (result.data) {
        const mappedData = result.data.map((row: any) => ({
          time: new Date(row.timestamp).getTime(),
          engine_temp: row.suhu_mesin,
          air_temp: row.suhu_udara,
          voltage: row.voltage,
          power: row.power_w,
          debit1: row.debit1,
          debit2: row.debit2,
          total1: row.total1,
          total2: row.total2,
          konsumsi: row.konsumsi,
          fuel_level: row.tinggi_bbm,
          fuel_pressure: row.tekanan_bbm
        }));
        
        let finalData = mappedData;
        // Recharts sangat berat jika data di atas 500 titik
        if (mappedData.length > 500) {
          const step = Math.ceil(mappedData.length / 500);
          finalData = mappedData.filter((_: any, i: number) => i % step === 0);
        }
        
        setHistoryData(finalData);

        if (result.data && result.data.length > 0) {
          const lastRow = result.data[result.data.length - 1];
          setCurrentData({
            type: lastRow.type,
            deviceId: lastRow.device_id,
            timestamp: lastRow.timestamp,
            gps: { lat: lastRow.lat, lon: lastRow.lon, alt: lastRow.alt, sog: lastRow.sog, cog: lastRow.cog },
            ultrasonic: { dist1: lastRow.dist1, dist2: lastRow.dist2 },
            flowmeter: { debit1: lastRow.debit1, debit2: lastRow.debit2, total1: lastRow.total1, total2: lastRow.total2, konsumsi: lastRow.konsumsi },
            bbm: { tinggi_bbm: lastRow.tinggi_bbm, tekanan_bbm: lastRow.tekanan_bbm },
            engine: { suhu_mesin: lastRow.suhu_mesin },
            power: { v: lastRow.voltage, i: lastRow.current_a, p: lastRow.power_w },
            environment: { suhu_udara: lastRow.suhu_udara, hum: lastRow.humidity, tek: lastRow.tekanan_udara },
            imu: { x: lastRow.imu_x, y: lastRow.imu_y, z: lastRow.imu_z }
          });
          
          let pathData = result.data.filter((row: any) => row.lat && row.lon);
          // Batasi titik koordinat peta maksimal 2000 agar tidak lag
          if (pathData.length > 2000) {
            const step = Math.ceil(pathData.length / 2000);
            pathData = pathData.filter((_: any, i: number) => i % step === 0);
          }
          const path: [number, number][] = pathData.map((row: any) => [row.lat, row.lon]);
          setHistoricalPath(path);
        } else {
          setHistoryData([]);
          setHistoricalPath([]);
          setCurrentData(null);
          alert('Tidak ada data pada rentang tanggal tersebut');
        }
      }
    } catch (err) {
      console.error('Gagal menarik data histori:', err);
      alert('Gagal mengambil data dari server');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {

    // Terhubung ke backend Node.js menggunakan URL dari .env
    const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:4001');

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('telemetry_data', (payload: TelemetryData) => {
      if (viewModeRef.current !== 'realtime') return;
      
      setCurrentData(payload);
      
      // Kumpulkan path riwayat khusus untuk Real-time
      if (payload.gps?.lat !== undefined && payload.gps?.lon !== undefined) {
        const now = Date.now();
        setRealtimePath(prev => {
          // Jika tidak ada data lebih dari 1 menit (60000 ms), mulai garis baru
          if (now - lastUpdateRef.current > 60000) {
            return [[payload.gps!.lat, payload.gps!.lon]];
          }
          
          const newPath: [number, number][] = [...prev, [payload.gps!.lat, payload.gps!.lon]];
          if (newPath.length > 2000) {
            return newPath.slice(newPath.length - 2000);
          }
          return newPath;
        });
        lastUpdateRef.current = now;
      }
      
      if (payload.deviceId) {
        setAvailableDevices(prev => prev.includes(payload.deviceId) ? prev : [...prev, payload.deviceId]);
        
        setActiveDeviceId(current => {
          if (!current) return payload.deviceId; // Auto select first device
          return current;
        });
      }

        // Gunakan functional update agar kita selalu membandingkan dengan nilai device yang terbaru
        setActiveDeviceId(currentActive => {
          if (currentActive && payload.deviceId && payload.deviceId !== currentActive) {
            return currentActive; // Ignore data from other devices
          }
          
          setCurrentData(payload);
          
          setHistoryData(prev => {
            const timeUnix = payload.timestamp ? new Date(payload.timestamp).getTime() : Date.now();
            const newDataPoint = {
              time: timeUnix,
              engine_temp: payload.engine?.suhu_mesin,
              air_temp: payload.environment?.suhu_udara,
              voltage: payload.power?.v,
              power: payload.power?.p,
              debit1: payload.flowmeter?.debit1,
              debit2: payload.flowmeter?.debit2,
              total1: payload.flowmeter?.total1,
              total2: payload.flowmeter?.total2,
              konsumsi: payload.flowmeter?.konsumsi,
              fuel_level: payload.bbm?.tinggi_bbm,
              fuel_pressure: payload.bbm?.tekanan_bbm
            };
            const updated = [...prev, newDataPoint];
            if (updated.length > 60) {
              return updated.slice(updated.length - 60);
            }
            return updated;
          });
          
          return currentActive || payload.deviceId;
        });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-800 font-sans p-4 md:p-6 flex flex-col">
      <header className="flex shrink-0 flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
            <Activity size={28} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-slate-900">
              Vessel Telemetry Dashboard
            </h1>
            <div className="flex gap-2 mt-1 items-center">
              <select 
                value={activeDeviceId} 
                onChange={(e) => setActiveDeviceId(e.target.value)}
                className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 border-none outline-none cursor-pointer"
              >
                <option value="" disabled>Select Device ID</option>
                {availableDevices.map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              {currentData?.type && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700 uppercase">
                  {currentData.type}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap sm:flex-row justify-center sm:justify-end items-center gap-3 w-full sm:w-auto">
          {/* Mode Toggle */}
          <div className="flex bg-slate-200 p-1 rounded-full shrink-0 w-full sm:w-auto justify-center">
            <button
              onClick={() => setViewMode('realtime')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${viewMode === 'realtime' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Real-time
            </button>
            <button
              onClick={() => setViewMode('history')}
              className={`flex-1 sm:flex-none px-4 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer ${viewMode === 'history' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              History
            </button>
          </div>

          <button 
            onClick={handleExportCSV}
            className="flex-1 sm:flex-none justify-center text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded-full shadow-sm flex items-center gap-2 transition-colors cursor-pointer shrink-0"
          >
            <Download size={16} />
            <span>Export CSV</span>
          </button>
          
          <div className="flex-1 sm:flex-none justify-center text-sm font-medium text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-full shadow-sm flex items-center gap-2 shrink-0 min-w-max">
            <div className={`w-1.5 h-1.5 rounded-full ${viewMode === 'realtime' ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'}`}></div>
            {currentTime.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' })} WIB
          </div>
          
          <div className="flex-1 sm:flex-none justify-center flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm shrink-0 min-w-max">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm font-medium text-slate-600">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* History Filter Bar */}
      {viewMode === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 shadow-sm flex flex-col md:flex-row items-end gap-4 shrink-0 animate-in slide-in-from-top-2 duration-300 fade-in">
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-slate-700 mb-1">Dari Tanggal & Jam</label>
            <input 
              type="datetime-local" 
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex-1 w-full">
            <label className="block text-sm font-medium text-slate-700 mb-1">Sampai Tanggal & Jam</label>
            <input 
              type="datetime-local" 
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={fetchHistory}
            disabled={isLoadingHistory}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors h-[38px] w-full md:w-auto cursor-pointer shrink-0"
          >
            {isLoadingHistory ? <Activity size={16} className="animate-spin" /> : <Search size={16} />}
            Tampilkan
          </button>
        </div>
      )}

      {/* Top Map Section */}
      <div className="mb-4 shrink-0">
        {/* Navigation (GPS) with Map */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-indigo-500">
              <Navigation size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Navigation</h2>
          </div>
          
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Map */}
            <div className="w-full lg:flex-1 h-[350px] min-h-[350px] rounded-lg overflow-hidden border border-slate-200 relative z-0 shrink-0">
              <MapContainer 
                center={(typeof currentData?.gps?.lat === 'number' && typeof currentData?.gps?.lon === 'number' && currentData.gps.lat !== 0) ? [currentData.gps.lat, currentData.gps.lon] : [-4.755477, 105.189018]} 
                zoom={14} 
                scrollWheelZoom={true} 
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />
                {(typeof currentData?.gps?.lat === 'number' && typeof currentData?.gps?.lon === 'number') && <MapUpdater center={[currentData.gps.lat, currentData.gps.lon]} />}
                {(typeof currentData?.gps?.lat === 'number' && typeof currentData?.gps?.lon === 'number') && (
                  <Marker position={[currentData.gps.lat, currentData.gps.lon]}>
                    <Popup>
                      <strong>Vessel Location</strong><br/>
                      Lat: {currentData.gps.lat}°<br/>
                      Lon: {currentData.gps.lon}°<br/>
                      Alt: {currentData.gps.alt ?? '--'} m
                    </Popup>
                  </Marker>
                )}
                {viewMode === 'history' && historicalPath.length > 0 && (
                  <Polyline positions={historicalPath} color="#4f46e5" weight={5} opacity={0.8} smoothFactor={1.5} lineCap="round" lineJoin="round" />
                )}
                {viewMode === 'realtime' && realtimePath.length > 1 && (
                  <Polyline positions={realtimePath} color="#ef4444" weight={5} opacity={0.8} dashArray="5, 10" smoothFactor={1.5} lineCap="round" lineJoin="round" />
                )}
              </MapContainer>
            </div>

            {/* GPS Info Panel */}
            <div className="lg:w-[260px] shrink-0 bg-slate-50 rounded-lg border border-slate-200 p-4 flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">GPS Coordinates</h3>
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">Latitude</span>
                  <span className="font-mono text-base font-semibold text-slate-800">{currentData?.gps?.lat ?? '--'}°</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">Longitude</span>
                  <span className="font-mono text-base font-semibold text-slate-800">{currentData?.gps?.lon ?? '--'}°</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">Altitude</span>
                  <span className="font-mono text-base font-semibold text-slate-800">{currentData?.gps?.alt ?? '--'} m</span>
                </div>
                <hr className="border-slate-200" />
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">SOG</span>
                  <span className="font-mono text-base font-semibold text-indigo-600">{currentData?.gps?.sog ?? '--'} kn</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 text-sm">COG</span>
                  <span className="font-mono text-base font-semibold text-indigo-600">{currentData?.gps?.cog ?? '--'}°</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sensor Cards - Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0 mb-4">
        {/* Ultrasonic */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-teal-500">
              <Waves size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Ultrasonic</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="Distance 1" value={currentData?.ultrasonic?.dist1} unit="cm" />
            <MetricBox label="Distance 2" value={currentData?.ultrasonic?.dist2} unit="cm" />
          </div>
        </div>

        {/* Engine */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-rose-500">
              <Cpu size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Engine</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="Engine Temp" value={currentData?.engine?.suhu_mesin} unit="°C" />
          </div>
        </div>

        {/* Environment */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-sky-500">
              <Cloud size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Environment</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="Air Temp" value={currentData?.environment?.suhu_udara} unit="°C" />
            <MetricBox label="Humidity" value={currentData?.environment?.hum} unit="%" />
            <MetricBox label="Pressure" value={currentData?.environment?.tek} unit="hPa" />
          </div>
        </div>

        {/* Fuel Tank */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-cyan-500">
              <Droplets size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Fuel Tank</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="Fuel Level" value={currentData?.bbm?.tinggi_bbm} unit="cm" />
            <MetricBox label="Fuel Pressure" value={currentData?.bbm?.tekanan_bbm} unit="kPa" />
          </div>
        </div>
      </div>

      {/* Sensor Cards - Row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0 mb-4">
        {/* Flow Meter */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-emerald-500">
              <Activity size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Flow Meter</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="Debit 1" value={currentData?.flowmeter?.debit1} unit="L/m" />
            <MetricBox label="Debit 2" value={currentData?.flowmeter?.debit2} unit="L/m" />
            <MetricBox label="Total 1" value={currentData?.flowmeter?.total1} unit="L" />
            <MetricBox label="Total 2" value={currentData?.flowmeter?.total2} unit="L" />
            <MetricBox label="Consumption" value={currentData?.flowmeter?.konsumsi} unit="L" />
          </div>
        </div>

        {/* Power */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-amber-500">
              <Zap size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">Power</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="Voltage" value={currentData?.power?.v} unit="V" />
            <MetricBox label="Current" value={currentData?.power?.i} unit="mA" />
            <MetricBox label="Power" value={currentData?.power?.p} unit="mW" />
          </div>
        </div>

        {/* IMU */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="text-purple-500">
              <Compass size={24} />
            </div>
            <h2 className="text-lg font-semibold text-slate-800">IMU</h2>
          </div>
          <div className="flex flex-col gap-3 mt-2">
            <MetricBox label="X-Axis" value={currentData?.imu?.x} unit="m/s²" />
            <MetricBox label="Y-Axis" value={currentData?.imu?.y} unit="m/s²" />
            <MetricBox label="Z-Axis" value={currentData?.imu?.z} unit="m/s²" />
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        
        {/* 1. Power */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col overflow-hidden shadow-sm h-[320px]">
          <h3 className="text-md font-semibold text-slate-800 mb-4">Power</h3>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke="#64748b" fontSize={12} tickMargin={10} minTickGap={30} tickFormatter={(val) => new Date(val).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})} />
                <YAxis yAxisId="left" stroke="#8b5cf6" fontSize={12} tickFormatter={(val) => `${val}W`} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={12} tickFormatter={(val) => `${val}V`} domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#1e293b', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '13px' }}
                  labelStyle={{ color: '#64748b', fontSize: '13px', marginBottom: '4px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Line yAxisId="left" type="monotone" dataKey="power" name="Power" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="voltage" name="Voltage" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Engine Temperature */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col overflow-hidden shadow-sm h-[320px]">
          <h3 className="text-md font-semibold text-slate-800 mb-4">Engine Temperature</h3>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke="#64748b" fontSize={12} tickMargin={10} minTickGap={30} tickFormatter={(val) => new Date(val).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})} />
                <YAxis stroke="#f43f5e" fontSize={12} tickFormatter={(val) => `${Math.round(val)}°C`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#1e293b', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '13px' }}
                  labelStyle={{ color: '#64748b', fontSize: '13px', marginBottom: '4px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Line type="monotone" dataKey="engine_temp" name="Engine" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. Fuel Volume */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col overflow-hidden shadow-sm h-[320px]">
          <h3 className="text-md font-semibold text-slate-800 mb-4">Fuel Volume & Pressure</h3>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke="#64748b" fontSize={12} tickMargin={10} minTickGap={30} tickFormatter={(val) => new Date(val).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})} />
                <YAxis yAxisId="left" stroke="#10b981" fontSize={12} tickFormatter={(val) => `${val}%`} domain={[0, 100]} />
                <YAxis yAxisId="right" orientation="right" stroke="#f97316" fontSize={12} tickFormatter={(val) => `${val}bar`} domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#1e293b', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '13px' }}
                  labelStyle={{ color: '#64748b', fontSize: '13px', marginBottom: '4px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Line yAxisId="left" type="monotone" dataKey="fuel_level" name="Level" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="fuel_pressure" name="Pressure" stroke="#f97316" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 4. Flow Meter */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col overflow-hidden shadow-sm h-[320px]">
          <h3 className="text-md font-semibold text-slate-800 mb-4">Flow Meter</h3>
          <div className="flex-1 w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} stroke="#64748b" fontSize={12} tickMargin={10} minTickGap={30} tickFormatter={(val) => new Date(val).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})} />
                <YAxis yAxisId="left" stroke="#06b6d4" fontSize={12} tickFormatter={(val) => `${val}L/h`} />
                <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={12} tickFormatter={(val) => `${val}L`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', color: '#1e293b', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '13px' }}
                  labelStyle={{ color: '#64748b', fontSize: '13px', marginBottom: '4px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Line yAxisId="left" type="monotone" dataKey="konsumsi" name="Consumption" stroke="#06b6d4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="left" type="monotone" dataKey="debit1" name="Debit 1" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="left" type="monotone" dataKey="debit2" name="Debit 2" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="total1" name="Total 1" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="total2" name="Total 2" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
