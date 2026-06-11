export interface TelemetryData {
  type?: string;
  deviceId?: string;
  gps?: { lat: number; lon: number; alt: number; sog: number; cog: number };
  ultrasonic?: { dist1: number; dist2: number };
  flowmeter?: { debit1: number; debit2: number; total1: number; total2: number; konsumsi: number };
  bbm?: { tinggi_bbm: number; tekanan_bbm: number };
  engine?: { suhu_mesin: number };
  power?: { v: number; i: number; p: number };
  environment?: { suhu_udara: number; hum: number; tek: number };
  imu?: { x: number; y: number; z: number };
  timestamp?: string;
}

export type ProtocolType = 'MQTT' | 'MQTTS' | 'WS' | 'WSS' | 'HTTP' | 'HTTPS';

export interface MqttSettings {
  protocol: ProtocolType;
  host: string;
  port: number;
  clientId: string;
  topic: string;
}
