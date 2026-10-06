export const EXCHANGES = {
    AUTH: "auth.events",
    ORDER: "order.events",
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
}
