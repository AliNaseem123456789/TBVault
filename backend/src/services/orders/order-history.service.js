/**
 * Writes one row to order_status_history. Call it inside the same transaction
 * that changes orders.status, so the timeline can never disagree with the order.
 * actorType: "customer" | "admin" | "system" | "payment"
 */
export const recordStatusChange = (tx, { orderId, from = null, to, actorType, actorUserId = null, note = null }) =>
    tx.orderStatusHistory.create({
        data: {
            order_id: orderId,
            from_status: from,
            to_status: to,
            actor_type: actorType,
            actor_user_id: actorUserId,
            note: note ? String(note).slice(0, 500) : null,
        },
    })
