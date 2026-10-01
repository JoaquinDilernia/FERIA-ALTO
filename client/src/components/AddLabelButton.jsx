import { useLabelQueue, addLabel, labelKey } from '../lib/labelQueue.js';

// Suma una etiqueta de este producto + condición a la cola de la pestaña
// Etiquetas, con el precio vigente (rebaja activa incluida).
export default function AddLabelButton({ product, condition }) {
  const queue = useLabelQueue();
  const inQueue = queue.find(i => i.key === labelKey(product.sku, condition))?.qty ?? 0;
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addLabel(product, condition)}
      title="Agregar a la cola de la pestaña Etiquetas">
      + Etiqueta{inQueue > 0 ? ` (${inQueue} en cola)` : ''}
    </button>
  );
}
