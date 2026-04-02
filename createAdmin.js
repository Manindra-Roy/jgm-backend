require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('./models/user'); // Ensure this path matches your structure

// Connect to the database using your environment variable
mongoose.connect(process.env.CONNECTION_STRING, {
    dbName: 'jgm-db' // Make sure this matches the dbName in your app.js
})
.then(async () => {
    console.log('✅ Connected to Database...');

    try {
        // 1. Check if an admin already exists (just in case)
        const existingAdmin = await User.findOne({ email: 'admin@jgmindustries.com' });
        if (existingAdmin) {
            console.log('⚠️ Admin user already exists! Deleting it to start fresh...');
            await User.findByIdAndDelete(existingAdmin._id);
        }

        // 2. Create the new Admin User
        const newAdmin = new User({
            name: 'Master Admin',
            email: 'admin@jgmindustries.com', // You can change this
            passwordHash: bcrypt.hashSync('Admin@123', 10), // You can change the password 'Admin@123'
            phone: '9999999999',
            isAdmin: true, // CRITICAL: This grants admin access
            street: '',
            apartment: '',
            zip: '',
            city: '',
            country: ''
        });

        await newAdmin.save();
        console.log('🎉 SUCCESS: Master Admin account created!');
        console.log('📧 Email: admin@jgmindustries.com');
        console.log('🔑 Password: Admin@123');

    } catch (error) {
        console.error('❌ Error creating admin:', error.message);
    } finally {
        // 3. Close the connection so the script exits
        mongoose.connection.close();
        console.log('👋 Database connection closed.');
    }
})
.catch((err) => {
    console.error('❌ Database connection failed:', err.message);
});