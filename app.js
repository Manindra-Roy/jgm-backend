/**
 * @fileoverview Main application entry point for JGM Industries Backend.
 * Initializes Express, connects to MongoDB, sets up security middleware,
 * configures routes, and establishes a WebSocket server for real-time analytics.
 */

// --- 1. CORE & THIRD-PARTY MODULES ---
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

// --- 2. LOCAL HELPERS & MIDDLEWARE ---
const authJwt = require('./helpers/jwt');
const errorHandler = require('./helpers/error-handler');

// --- 3. ROUTE IMPORTS ---
const categoriesRoutes = require('./routes/categories');
const productsRoutes = require('./routes/products');
const usersRoutes = require('./routes/users');
const ordersRoutes = require('./routes/orders');
const paymentsRoutes = require('./routes/payments');

// --- INITIALIZATION ---
const app = express();
const api = process.env.API_URL;

// --- 4. CORS CONFIGURATION ---
/**
 * Strict Cross-Origin Resource Sharing (CORS) policy.
 * Only allows traffic from specified frontends to prevent unauthorized API access.
 */
const allowedOrigins = [
    'https://www.jgmindustries.in', 
    'https://admin.jgmindustries.in', 
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174'
];

const corsOptions = {
    origin: function(origin, callback) {
        if(!origin) return callback(null, true);
        if(allowedOrigins.indexOf(origin) === -1){
            return callback(new Error('CORS policy violation: Origin not allowed.'), false);
        }
        return callback(null, true);
    },
    credentials: true // Required for HTTP-only cookies
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- 5. SECURITY & PARSING MIDDLEWARE ---
app.use(helmet());                     // Secures HTTP headers
app.use(mongoSanitize());              // Prevents NoSQL Injection attacks
app.use(express.json());               // Parses incoming JSON payloads
app.use(cookieParser());               // Parses HTTP-only cookies for JWT auth
app.use(morgan('tiny'));               // Logs HTTP requests
app.use(authJwt());                    // Verifies JWT tokens (protects routes)
app.use(errorHandler);                 // Global error handling wrapper

// --- 6. ROUTE DECLARATIONS ---
app.use(`${api}/categories`, categoriesRoutes);
app.use(`${api}/products`, productsRoutes);
app.use(`${api}/users`, usersRoutes);
app.use(`${api}/orders`, ordersRoutes);
app.use(`${api}/payments`, paymentsRoutes);

// --- 7. DATABASE CONNECTION ---
mongoose.connect(process.env.CONNECTION_STRING, {
    dbName: 'jgm-db'
})
.then(() => console.log('✅ JGM Database Connection is ready...'))
.catch((err) => console.error('❌ Database Connection Error:', err));

// --- 8. WEBSOCKET SERVER (REAL-TIME ANALYTICS) ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

let liveUserCount = 0;

io.on('connection', (socket) => {
    liveUserCount++;
    io.emit('liveUsersUpdate', liveUserCount);

    socket.on('disconnect', () => {
        liveUserCount = Math.max(0, liveUserCount - 1); // Ensures count never drops below 0
        io.emit('liveUsersUpdate', liveUserCount);
    });
});

// --- 9. SERVER IGNITION ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 JGM Backend server is running on port ${PORT}`);
});