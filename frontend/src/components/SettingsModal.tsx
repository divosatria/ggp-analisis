import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { MqttSettings, ProtocolType } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: MqttSettings;
  onSave: (settings: MqttSettings) => void;
}

export default function SettingsModal({ isOpen, onClose, settings, onSave }: SettingsModalProps) {
  const [formData, setFormData] = useState<MqttSettings>(settings);

  useEffect(() => {
    setFormData(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleProtocolChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const protocol = e.target.value as ProtocolType;
    let port = formData.port;
    if (protocol === 'HTTP') port = 80;
    else if (protocol === 'HTTPS') port = 443;
    else if (protocol === 'MQTT') port = 1883;
    else if (protocol === 'MQTTS') port = 8883;
    else if (protocol === 'WS') port = 8000;
    else if (protocol === 'WSS') port = 8884;
    
    setFormData({ ...formData, protocol, port });
  };

  const isHttpOrWs = ['HTTP', 'HTTPS', 'WS', 'WSS'].includes(formData.protocol);
  const topicLabel = isHttpOrWs ? 'Endpoint / Path' : 'MQTT Topic';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Connection Settings</h2>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">Protocol</label>
            <select 
              value={formData.protocol}
              onChange={handleProtocolChange}
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-md py-2 px-3 focus:outline-none focus:border-blue-500"
            >
              <option value="MQTT">MQTT</option>
              <option value="MQTTS">MQTTS</option>
              <option value="WS">WS</option>
              <option value="WSS">WSS</option>
              <option value="HTTP">HTTP</option>
              <option value="HTTPS">HTTPS</option>
            </select>
          </div>
          
          <div className="flex space-x-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-500 mb-1">Host</label>
              <input 
                type="text" 
                value={formData.host}
                onChange={e => setFormData({ ...formData, host: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-md py-2 px-3 focus:outline-none focus:border-blue-500"
                placeholder="broker.hivemq.com"
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-slate-500 mb-1">Port</label>
              <input 
                type="number" 
                value={formData.port}
                onChange={e => setFormData({ ...formData, port: Number(e.target.value) })}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-md py-2 px-3 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">Client ID</label>
            <input 
              type="text" 
              value={formData.clientId}
              onChange={e => setFormData({ ...formData, clientId: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-md py-2 px-3 text-slate-800 focus:outline-none focus:border-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-500 mb-1">{topicLabel}</label>
            <input 
              type="text" 
              value={formData.topic}
              onChange={e => setFormData({ ...formData, topic: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-md py-2 px-3 focus:outline-none focus:border-blue-500"
              placeholder="/vessel/telemetry"
            />
          </div>
        </div>
        
        <div className="p-4 border-t border-slate-200 flex justify-end">
          <button 
            onClick={() => onSave(formData)}
            className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-6 rounded-md transition-colors"
          >
            Save & Connect
          </button>
        </div>
      </div>
    </div>
  );
}
