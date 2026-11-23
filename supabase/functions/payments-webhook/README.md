# Vínculos verificados de Paddle

El webhook reenvía cada evento de suscripción firmado a Tchurch antes de actualizar el registro histórico de Supabase. La copia en Supabase solo cambia si ya existe un vínculo verificado para la suscripción, el cliente y el entorno. El evento nunca define el propietario local.

Los registros históricos sin `paddle_binding_verified_at` quedan excluidos de `has_active_subscription`. Conserva esos registros para auditoría. Antes de marcar un vínculo, un operador autorizado debe comprobar en Paddle la cuenta, el cliente, la suscripción, el entorno, el producto y el precio, y asociarlos al usuario autorizado según el registro de compra de Tchurch.

Para vincular un cliente legítimo nuevo, el operador registra esa asociación con el rol de servicio y estado inicial `inactive`. Para validar una fila histórica legítima, el operador comprueba los mismos datos y restablece el estado a `inactive` en la misma actualización que establece `paddle_binding_verified_at`. Un evento firmado confirma el estado actual. El producto y el precio del vínculo deben coincidir con el evento para activar el registro. Una cancelación válida se aplica aunque el producto o el precio ya no estén presentes.

La marca `paddle_last_event_at` impide que una entrega anterior revierta una actualización más reciente. Si falla la entrega a Tchurch o la actualización del registro local, el webhook responde con un error para que Paddle reintente.
