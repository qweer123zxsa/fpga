import { useEffect, useState } from "react";
import type { AppSettings } from "../../types/electron";

type Props = {
  visible: boolean;
  initialSettings: AppSettings | null;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
};

const defaultSettings: AppSettings = {
  modelProvider: "deepseek",
  apiKey: "",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
};

export function SettingsModal({ visible, initialSettings, onClose, onSave }: Props) {
  const [form, setForm] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    if (initialSettings) setForm(initialSettings);
  }, [initialSettings]);

  if (!visible) return null;

  return (
    <div className="modal-mask">
      <div className="modal-card">
        <h3>模型设置</h3>
        <label>
          Provider
          <select
            value={form.modelProvider}
            onChange={(event) =>
              setForm((state) => ({
                ...state,
                modelProvider: event.target.value as AppSettings["modelProvider"],
              }))
            }
          >
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI Compatible</option>
          </select>
        </label>
        <label>
          API Key
          <input
            value={form.apiKey}
            type="password"
            onChange={(event) => setForm((state) => ({ ...state, apiKey: event.target.value }))}
          />
        </label>
        <label>
          Model
          <input
            value={form.model}
            onChange={(event) => setForm((state) => ({ ...state, model: event.target.value }))}
          />
        </label>
        <label>
          Base URL
          <input
            value={form.baseUrl}
            onChange={(event) => setForm((state) => ({ ...state, baseUrl: event.target.value }))}
          />
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button
            onClick={() => {
              onSave(form);
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
