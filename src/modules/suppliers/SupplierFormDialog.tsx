// docs/17-M12-SUPPLIERS.md §1 — name is the only required field; everything
// else can be filled in later. Certifications are free-text tags, comma
// separated here — no fixed taxonomy imposed on day one.
import { useState } from 'react'
import { createSupplier, updateSupplier } from '@/lib/suppliers'
import type { Supplier } from '@/lib/types'

type Props = {
  existing?: (Supplier & { id: string }) | null
  onClose: () => void
}

export function SupplierFormDialog({ existing, onClose }: Props) {
  const [name, setName] = useState(existing?.name ?? '')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [contactName, setContactName] = useState(existing?.contactName ?? '')
  const [contactPhone, setContactPhone] = useState(existing?.contactPhone ?? '')
  const [contactEmail, setContactEmail] = useState(existing?.contactEmail ?? '')
  const [certifications, setCertifications] = useState((existing?.certifications ?? []).join(', '))
  const [paymentTerms, setPaymentTerms] = useState(existing?.paymentTerms ?? '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const data = {
        name: name.trim(),
        category: category.trim(),
        contactName: contactName.trim() === '' ? null : contactName.trim(),
        contactPhone: contactPhone.trim() === '' ? null : contactPhone.trim(),
        contactEmail: contactEmail.trim() === '' ? null : contactEmail.trim(),
        certifications: certifications
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c !== ''),
        paymentTerms: paymentTerms.trim() === '' ? null : paymentTerms.trim(),
        active,
      }

      if (existing) {
        await updateSupplier(existing.id, data)
      } else {
        await createSupplier(data)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this supplier.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h3>{existing ? `Edit ${existing.name}` : 'Add supplier'}</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Category
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. beverages, produce" />
        </label>
        <label>
          Contact name
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </label>
        <label>
          Contact phone
          <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </label>
        <label>
          Contact email
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </label>
        <label>
          Certifications (comma separated)
          <input value={certifications} onChange={(e) => setCertifications(e.target.value)} placeholder="Halal, FDA-registered" />
        </label>
        <label>
          Payment terms
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 30, COD" />
        </label>
        <label className="dialog__checkbox">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>

        {error && <p className="dialog__error">{error}</p>}
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
