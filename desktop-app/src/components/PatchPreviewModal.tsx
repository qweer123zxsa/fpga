type Props = {
  visible: boolean;
  patchText: string;
  targetPath: string;
  onCancel: () => void;
  onApply: () => void;
};

export function PatchPreviewModal({
  visible,
  patchText,
  targetPath,
  onCancel,
  onApply,
}: Props) {
  if (!visible) return null;

  return (
    <div className="modal-mask">
      <div className="modal-card patch">
        <h3>补丁预览</h3>
        <div className="patch-target">{targetPath}</div>
        <pre className="patch-content">{patchText}</pre>
        <div className="modal-actions">
          <button onClick={onCancel}>取消</button>
          <button onClick={onApply}>应用到文件</button>
        </div>
      </div>
    </div>
  );
}
