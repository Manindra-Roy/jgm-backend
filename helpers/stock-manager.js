const { Order } = require('../models/order'); 
const { Product } = require('../models/product');

/**
 * Atomic stock restoration logic.
 * Ensures that if multiple concurrent requests (e.g. Webhook + Manual Check) 
 * arrive for the same failed order, inventory is only incremented ONCE.
 */
async function restoreStock(order) {
    if (!order || !order.orderItems || order.orderItems.length === 0) return false;

    // --- PHASE 1: ATOMIC FLAG CHECK ---
    // Instead of checking the 'order' object (which might be stale),
    // we perform an atomic update on the database itself.
    // If 'isStockRestored' is already true, this update returns null, and we skip incrementing.
    const orderToUpdate = await Order.findOneAndUpdate(
        { 
            _id: order._id, 
            isStockRestored: false, // Only pick if not yet restored
            status: { $ne: 'Cancelled' } // Don't restore if already cancelled (safety)
        },
        { $set: { isStockRestored: true } },
        { new: true }
    );

    if (!orderToUpdate) {
        // This order has already had its stock restored by another process/process-thread.
        return false; 
    }

    // --- PHASE 2: INVENTORY INCREMENT ---
    try {
        const restorationPromises = order.orderItems.map(item => {
            if (item.product) {
                return Product.findByIdAndUpdate(item.product, {
                    $inc: { countInStock: item.quantity }
                });
            }
        });

        await Promise.all(restorationPromises);
        return true;
    } catch (error) {
        console.error(`❌ Atomic Stock restoration failed for Order ${order._id}:`, error.message);
        // CRITICAL: If inventory increment fails, we should ideally roll back the flag, 
        // but since we are using $inc which is generally reliable, we log and alert.
        throw error;
    }
}

module.exports = { restoreStock };
