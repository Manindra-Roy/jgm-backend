/**
 * @fileoverview Main application entry point for JGM Industries Backend.
 * PRODUCTION MODE: Strict CORS, Helmet Security, and Mongoose Sanitization.
 */

const http = require('http'); 
const express = require('express');
require('express-async-errors'); 
const { Server } = require('socket.io'); 
const mongoose = require('mongoose');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
require('dotenv/config');

const authJwt = require('./helpers/jwt');
const errorHandler = require('./helpers/error-handler');

const categoriesRoutes = require('./routes/categories');
const productsRoutes = require('./routes/products');
const usersRoutes = require('./routes/users');
const ordersRoutes = require('./routes/orders');
const paymentsRoutes = require('./routes/payments');

const app = express();
const api = process.env.API_URL || '/api/v1';

// --- STRICT PRODUCTION CORS ---
const allowedOrigins = [
    'https://jgmindustries.in',
    'https://www.jgmindustries.in', 
    'https://admin.jgmindustries.in',
    'https://jgm-frontend-v1.vercel.app' // Fallback Vercel URL
];

const corsOptions = {
    origin: function(origin, callback) {
        if(!origin) return callback(null, true);
        if(allowedOrigins.indexOf(origin) === -1){
            return callback(new Error('CORS policy violation: Origin not allowed.'), false);
        }
        return callback(null, true);
    },
    credentials: true 
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- SECURITY MIDDLEWARE ---
app.use(helmet());                     
app.use(mongoSanitize());              
app.use(express.json());               
app.use(cookieParser());               
app.use(morgan('tiny'));               
app.use(authJwt());                    
app.use(errorHandler);                 

// --- ROUTE DECLARATIONS ---
app.use(`${api}/categories`, categoriesRoutes);
app.use(`${api}/products`, productsRoutes);
app.use(`${api}/users`, usersRoutes);
app.use(`${api}/orders`, ordersRoutes);
app.use(`${api}/payments`, paymentsRoutes);

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.CONNECTION_STRING, {
    dbName: 'jgm-db'
})
.then(() => console.log('✅ JGM Database Connection is ready...'))
.catch((err) => console.error('❌ Database Connection Error:', err));

// --- WEBSOCKET SERVER ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

let liveUserCount = 0;

io.on('connection', (socket) => {
    liveUserCount++;
    io.emit('liveUsersUpdate', liveUserCount);

    socket.on('disconnect', () => {
        liveUserCount = Math.max(0, liveUserCount - 1); 
        io.emit('liveUsersUpdate', liveUserCount);
    });
});

// --- SERVER IGNITION ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 JGM Backend PRODUCTION server running on port ${PORT}`);
});
