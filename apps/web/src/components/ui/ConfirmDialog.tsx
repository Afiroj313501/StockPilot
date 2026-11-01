import { Button } from './Button';
import { Modal } from './Modal';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm text-slate-600">{message}</p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
