const { Order } = require("../models/order");
const express = require("express");
const { OrderItem } = require("../models/order-item");
const router = express.Router();

router.get(`/`, async (req, res) => {
  const orderList = await Order.find()
    .populate("user", "name")
    .sort({ dateOrdered: -1 });

  if (!orderList) {
    res.status(500).json({ success: false });
  }
  res.send(orderList);
});

router.get(`/:id`, async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate("user", "name")
    .populate({
      path: "orderItems",
      populate: {
        path: "product",
        populate: "category",
      },
    });

  if (!order) {
    res.status(500).json({ success: false });
  }
  res.send(order);
});

// GET: Unified Dashboard Statistics (Highly Optimized)
router.get("/get/dashboard-stats", async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();

    // 1. Group Statuses
    const statusCountsAgg = await Order.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const statusCounts = statusCountsAgg.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    // 2. Safe Total Sales (Converts string to numbers natively, ignores cancellations)
    const salesAgg = await Order.aggregate([
      { $match: { status: { $ne: "Cancelled" } } },
      {
        $group: {
          _id: null,
          totalSales: {
            $sum: {
              $convert: {
                input: "$totalPrice",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]);
    const totalSales = salesAgg.length > 0 ? salesAgg[0].totalSales : 0;

    // 3. Sales By Day (Last 14 days)
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 14);

    const dailySales = await Order.aggregate([
      {
        $match: {
          dateOrdered: { $gte: pastDate },
          status: { $ne: "Cancelled" },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$dateOrdered" } },
          totalSales: {
            $sum: {
              $convert: {
                input: "$totalPrice",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
      { $sort: { _id: 1 } }, // Sort chronologically
    ]);

    // 4. Fetch only the 5 most recent orders for the table
    const recentOrders = await Order.find()
      .populate("user", "name")
      .sort({ dateOrdered: -1 })
      .limit(5);

    // Send everything in one single payload
    res.status(200).json({
      totalOrders,
      statusCounts,
      totalSales,
      dailySales,
      recentOrders,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  const orderItemsIds = Promise.all(
    req.body.orderItems.map(async (orderItem) => {
      let newOrderItem = new OrderItem({
        quantity: orderItem.quantity,
        product: orderItem.product,
      });

      newOrderItem = await newOrderItem.save();

      return newOrderItem._id;
    }),
  );
  const orderItemsIdsResolved = await orderItemsIds;

  const totalPrices = await Promise.all(
    orderItemsIdsResolved.map(async (orderItemId) => {
      const orderItem = await OrderItem.findById(orderItemId).populate(
        "product",
        "price",
      );
      const totalPrice = orderItem.product.price * orderItem.quantity;
      return totalPrice;
    }),
  );

  const totalPrice = totalPrices.reduce((a, b) => a + b, 0);

  let order = new Order({
    orderItems: orderItemsIdsResolved,
    shippingAddress1: req.body.shippingAddress1,
    shippingAddress2: req.body.shippingAddress2,
    city: req.body.city,
    zip: req.body.zip,
    country: req.body.country,
    phone: req.body.phone,
    status: req.body.status,
    totalPrice: totalPrice,
    user: req.body.user,
  });
  order = await order.save();

  if (!order) return res.status(400).send("the order cannot be created!");

  res.send(order);
});

router.put("/:id", async (req, res) => {
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    {
      status: req.body.status,
    },
    // { new: true}
    { returnDocument: "after" },
  );

  if (!order) return res.status(400).send("the order cannot be update!");

  res.send(order);
});

// DELETE Order & Associated Order Items
router.delete("/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);

    if (order) {
      // Promise.all ensures we wait for ALL items to be deleted before moving on
      await Promise.all(
        order.orderItems.map(async (orderItem) => {
          // Changed from findByIdAndRemove to findByIdAndDelete
          await OrderItem.findByIdAndDelete(orderItem);
        }),
      );

      return res.status(200).json({
        success: true,
        message: "The order and its items were deleted!",
      });
    } else {
      return res
        .status(404)
        .json({ success: false, message: "Order not found!" });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get(`/get/count`, async (req, res) => {
  try {
    const orderCount = await Order.countDocuments();
    // Since 0 is a valid number, we just send it directly!
    res.status(200).send({ orderCount: orderCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get(`/get/userorders/:userid`, async (req, res) => {
  const userOrderList = await Order.find({ user: req.params.userid })
    .populate({
      path: "orderItems",
      populate: {
        path: "product",
        populate: "category",
      },
    })
    .sort({ dateOrdered: -1 });

  if (!userOrderList) {
    res.status(500).json({ success: false });
  }
  res.send(userOrderList);
});

module.exports = router;
