const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A cleaned-up email address, or null.
export const parseEmail = (value) => {
    const email = typeof value === "string" ? value.trim().toLowerCase() : ""
    return EMAIL_RE.test(email) && email.length <= 255 ? email : null
}
