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

// GET: Count of orders grouped by their Status
router.get('/get/statuscounts', async (req, res) => {
    try {
        const statusCounts = await Order.aggregate([
            {
                // Group by the 'status' field and add 1 to the count for each document found
                $group: {
                    _id: "$status",
                    count: { $sum: 1 }
                }
            }
        ]);

        // MongoDB returns an array like: [{_id: 'Pending', count: 4}, {_id: 'Delivered', count: 12}]
        // Let's format this into a clean, easy-to-use object for React
        const formattedCounts = statusCounts.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        res.status(200).send(formattedCounts);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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

router.get("/get/totalsales", async (req, res) => {
  try {
    const totalSales = await Order.aggregate([
      { $group: { _id: null, totalsales: { $sum: "$totalPrice" } } },
    ]);

    // If the array is empty (no orders), return 0
    if (!totalSales || totalSales.length === 0) {
      return res.status(200).send({ totalsales: 0 });
    }

    res.send({ totalsales: totalSales.pop().totalsales });
  } catch (err) {
    res.status(500).send("The order sales cannot be generated");
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

// GET Sales grouped by Day (For Dashboard Chart)
router.get("/get/salesbyday", async (req, res) => {
  try {
    const salesData = await Order.aggregate([
      {
        // Group by the date (formatted as YYYY-MM-DD)
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$dateOrdered" } },
          totalSales: { $sum: "$totalPrice" },
          ordersCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } }, // Sort by date ascending (oldest to newest)
      { $limit: 14 }, // Get the last 14 active days
    ]);

    // Format the data nicely for the frontend chart
    const formattedData = salesData.map((data) => ({
      date: data._id,
      sales: data.totalSales,
      orders: data.ordersCount,
    }));

    res.status(200).send(formattedData);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
