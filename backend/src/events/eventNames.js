export const EXCHANGES = {
    AUTH: "auth.events",
    ORDER: "order.events",
    INVENTORY: "inventory.events",
    CATALOG: "catalog.events",
    SUPPORT: "support.events",
}

export const AUTH_EVENTS={
    USER_CREATED:"auth.user.created",
    PASSWORD_RESET_REQUESTED:"auth.password.reset.requested",
    PASSWORD_CHANGED:"auth.password.changed",
    EMAIL_VERIFICATION_REQUESTED:"auth.email.verification.requested",
    EMAIL_VERIFIED:"auth.email.verified"
}

export const ORDER_EVENTS = {
    ORDER_CREATED: "order.created",
    ORDER_STATUS_CHANGED: "order.status.changed",
    ORDER_PAID: "order.paid",
    ORDER_REFUNDED: "order.refunded",
    RETURN_UPDATED: "order.return.updated",
}

// Products changed in a way search cares about (read by the chatbot's sync worker).
export const CATALOG_EVENTS = {
    CHANGED: "catalog.changed",
}

// Messages from the Contact us page (the email worker forwards them to the store's inbox).
export const SUPPORT_EVENTS = {
    CONTACT_RECEIVED: "support.contact.received",
}

export const INVENTORY_EVENTS = {
    LOW_STOCK: "inventory.low_stock",
    BACK_IN_STOCK: "inventory.back_in_stock",
}
