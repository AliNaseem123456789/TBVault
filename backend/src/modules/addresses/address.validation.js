const FIELDS = {
    label: { max: 50, required: false },
    full_name: { max: 100, required: true },
    phone: { max: 30, required: true },
    line1: { max: 200, required: true },
    line2: { max: 200, required: false },
    city: { max: 100, required: true },
    state: { max: 100, required: false },
    postal_code: { max: 20, required: false },
    country: { max: 100, required: true },
}

const LABELS = { full_name: "full name", line1: "street address", postal_code: "postal code" }

/** Validates an address body. `partial` is for updates. Returns { data } or { error }. */
export const parseAddressInput = (body = {}, { partial = false } = {}) => {
    const data = {}
    for (const [field, rule] of Object.entries(FIELDS)) {
        const raw = body[field]
        if (raw === undefined) {
            if (rule.required && !partial) return { error: `${LABELS[field] ?? field} is required` }
            continue
        }
        if (raw !== null && typeof raw !== "string") return { error: `${LABELS[field] ?? field} must be text` }
        const value = raw?.trim() || null
        if (rule.required && !value) return { error: `${LABELS[field] ?? field} is required` }
        if (value && value.length > rule.max) return { error: `${LABELS[field] ?? field} must be at most ${rule.max} characters` }
        data[field] = value
    }
    if (body.phone !== undefined && data.phone && !/^[+()\-\s\d]{6,30}$/.test(data.phone)) {
        return { error: "phone number doesn't look right" }
    }
    if (body.is_default !== undefined) {
        if (typeof body.is_default !== "boolean") return { error: "is_default must be true or false" }
        data.is_default = body.is_default
    }
    return { data }
}

/** One text block for orders.shipping_address (the order keeps a snapshot, not a link). */
export const formatAddress = (a) =>
    [
        a.full_name,
        a.line1,
        a.line2,
        [a.city, a.state, a.postal_code].filter(Boolean).join(", "),
        a.country,
        a.phone && `Phone: ${a.phone}`,
    ]
        .filter(Boolean)
        .join("\n")
