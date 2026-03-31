const express = require('express');
const app = express();
require('express-async-errors'); // Must be included before routes
const morgan = require('morgan');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
require('dotenv/config');
const authJwt = require('./helpers/jwt');
const errorHandler = require('./helpers/error-handler');
const cookieParser = require('cookie-parser');

// Strict CORS Policy for JGM Industries
const allowedOrigins = ['https://www.jgmindustries.in', 'https://admin.jgmindustries.in', 'http://localhost:3000','http://localhost:5173','http://localhost:5174'];

const corsOptions = {
    origin: function(origin, callback){
        // allow requests with no origin (like mobile apps or curl requests)
        if(!origin) return callback(null, true);
        
        if(allowedOrigins.indexOf(origin) === -1){
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true // <--- THIS IS THE MISSING PIECE!
};


// 1. Apply strict policy to standard requests (GET, POST, etc.)
app.use(cors(corsOptions));

// 2. Apply the EXACT SAME strict policy to Preflight (OPTIONS) requests
app.options('*', cors(corsOptions));

// --- SECURITY MIDDLEWARE ---
// 1. Secure HTTP headers
app.use(helmet());

// 2. Prevent NoSQL Injections
app.use(mongoSanitize());

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(morgan('tiny'));
app.use(authJwt());
app.use(errorHandler);

// Routes
const categoriesRoutes = require('./routes/categories');
const productsRoutes = require('./routes/products');
const usersRoutes = require('./routes/users');
const ordersRoutes = require('./routes/orders');
const paymentsRoutes = require('./routes/payments');

const api = process.env.API_URL;

// Active Route Declarations
app.use(`${api}/categories`, categoriesRoutes);
app.use(`${api}/products`, productsRoutes);
app.use(`${api}/users`, usersRoutes);
app.use(`${api}/orders`, ordersRoutes);
app.use(`${api}/payments`, paymentsRoutes);

// Database Connection
mongoose.connect(process.env.CONNECTION_STRING, {
    dbName: 'jgm-db'
})
.then(() => console.log('JGM Database Connection is ready...'))
.catch((err) => console.log(err));

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`JGM Backend server is running on port ${PORT}`);
});