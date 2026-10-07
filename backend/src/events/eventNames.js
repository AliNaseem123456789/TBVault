export const EXCHANGES = {
    AUTH: "auth.events",
    ORDER: "order.events",
    INVENTORY: "inventory.events",
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

export const INVENTORY_EVENTS = {
    LOW_STOCK: "inventory.low_stock",
    BACK_IN_STOCK: "inventory.back_in_stock",
}
