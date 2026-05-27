const request = require('supertest');
const crypto = require('crypto');
const axios = require('axios');
const orderRepository = require('../repositories/OrderRepository');

// Setup environment variables before requiring the app
process.env.secret = 'test-secret-key-12345';
process.env.API_URL = '/api/v1';
process.env.NODE_ENV = 'test';
process.env.PHONEPE_MERCHANT_ID = 'TEST_MERCHANT_ID';
process.env.PHONEPE_SALT_KEY = 'TEST_SALT_KEY';
process.env.PHONEPE_SALT_INDEX = '1';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.PHONEPE_WEBHOOK_URL = 'http://localhost:3000/api/v1/payments/webhook';

const { app } = require('../app');

// Mock external integrations
jest.mock('axios');
jest.mock('../repositories/OrderRepository');

describe('PhonePe Payments Route Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/v1/payments/checkout/:orderId', () => {
        it('should return 404 if order is not found', async () => {
            orderRepository.findById.mockResolvedValue(null);

            const res = await request(app).post('/api/v1/payments/checkout/order123');
            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('Order not found');
        });

        it('should return 500 if the order has already been paid for', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Paid',
                totalPrice: 100
            });

            const res = await request(app).post('/api/v1/payments/checkout/order123');
            expect(res.statusCode).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('already been paid for');
        });

        it('should initiate payment, update transactionId in DB BEFORE making PhonePe API call, and return paymentUrl', async () => {
            const mockOrder = {
                _id: '60c72b2f9b1d8b2a3c9d4e5f',
                paymentStatus: 'Pending',
                totalPrice: 150.50,
                user: 'user789'
            };
            orderRepository.findById.mockResolvedValue(mockOrder);
            orderRepository.update.mockResolvedValue({ ...mockOrder, transactionId: 'JGM-9d4e5f-123456789-abcdef' });
            
            axios.post.mockResolvedValue({
                data: {
                    data: {
                        instrumentResponse: {
                            redirectInfo: {
                                url: 'https://phonepe.com/mock-redirect'
                            }
                        }
                    }
                }
            });

            const res = await request(app).post('/api/v1/payments/checkout/60c72b2f9b1d8b2a3c9d4e5f');
            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.paymentUrl).toBe('https://phonepe.com/mock-redirect');

            expect(orderRepository.update).toHaveBeenCalledTimes(1);
            expect(orderRepository.update.mock.calls[0][0].toString()).toBe(mockOrder._id);
            // Verify JGM-{last6_order_id}-{timestamp}-{randomSuffix} format
            expect(orderRepository.update.mock.calls[0][1].transactionId).toMatch(/^JGM-\w+-\d+-\w+$/);

            expect(axios.post).toHaveBeenCalledTimes(1);
            
            const updateCallOrder = orderRepository.update.mock.invocationCallOrder[0];
            const axiosPostCallOrder = axios.post.mock.invocationCallOrder[0];
            expect(updateCallOrder).toBeLessThan(axiosPostCallOrder);
        });
    });

    describe('GET /api/v1/payments/checkout/:orderId', () => {
        it('should redirect to the payment URL on success', async () => {
            const mockOrder = {
                _id: '60c72b2f9b1d8b2a3c9d4e5f',
                paymentStatus: 'Pending',
                totalPrice: 100,
                user: 'user789'
            };
            orderRepository.findById.mockResolvedValue(mockOrder);
            axios.post.mockResolvedValue({
                data: {
                    data: {
                        instrumentResponse: {
                            redirectInfo: {
                                url: 'https://phonepe.com/mock-redirect'
                            }
                        }
                    }
                }
            });

            const res = await request(app).get('/api/v1/payments/checkout/60c72b2f9b1d8b2a3c9d4e5f');
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('https://phonepe.com/mock-redirect');
        });
    });

    describe('POST /api/v1/payments/webhook', () => {
        const generateWebhookPayload = (payload, saltKey, saltIndex) => {
            const base64Response = Buffer.from(JSON.stringify(payload)).toString('base64');
            const stringToHash = base64Response + saltKey;
            const checksum = crypto.createHash('sha256').update(stringToHash).digest('hex') + '###' + saltIndex;
            return { base64Response, checksum };
        };

        it('should return 400 for missing header or body', async () => {
            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .send({});
            expect(res.statusCode).toBe(400);
            expect(res.text).toBe('Missing payload requirements');
        });

        it('should return 400 for invalid checksums', async () => {
            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', 'invalid-checksum')
                .send({ response: 'base64Payload' });
            
            expect(res.statusCode).toBe(400);
            expect(res.text).toBe('Invalid Checksum');
        });

        it('should return 400 for malformed base64 JSON payload structurally invalid', async () => {
            const malformedBase64 = Buffer.from("{invalid-json").toString('base64');
            const stringToHash = malformedBase64 + 'TEST_SALT_KEY';
            const checksum = crypto.createHash('sha256').update(stringToHash).digest('hex') + '###' + '1';

            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', checksum)
                .send({ response: malformedBase64 });

            expect(res.statusCode).toBe(400);
            expect(res.text).toBe('Malformed Base64 JSON Payload structurally invalid');
        });

        it('should return 400 if merchantTransactionId is missing in response JSON', async () => {
            const responseData = {
                code: 'PAYMENT_SUCCESS',
                data: {
                    amount: 10000
                }
            };
            const { base64Response, checksum } = generateWebhookPayload(responseData, 'TEST_SALT_KEY', '1');

            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', checksum)
                .send({ response: base64Response });

            expect(res.statusCode).toBe(400);
            expect(res.text).toBe('Missing Identification parameter context');
        });

        it('should return 404 if order associated with merchantTransactionId is not found', async () => {
            const responseData = {
                code: 'PAYMENT_SUCCESS',
                data: {
                    merchantTransactionId: 'JGM-nonexistent-123',
                    amount: 10000,
                    transactionId: 'T123456789'
                }
            };
            const { base64Response, checksum } = generateWebhookPayload(responseData, 'TEST_SALT_KEY', '1');
            orderRepository.findByTransactionId.mockResolvedValue(null);

            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', checksum)
                .send({ response: base64Response });

            expect(res.statusCode).toBe(404);
            expect(res.text).toBe('Order reference pointer mismatch');
        });

        it('should return 200 OK immediately if order is already Paid', async () => {
            const responseData = {
                code: 'PAYMENT_SUCCESS',
                data: {
                    merchantTransactionId: 'JGM-9d4e5f-12345',
                    amount: 10000,
                    transactionId: 'T123456789'
                }
            };
            const { base64Response, checksum } = generateWebhookPayload(responseData, 'TEST_SALT_KEY', '1');
            orderRepository.findByTransactionId.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Paid',
                status: 'Processing'
            });

            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', checksum)
                .send({ response: base64Response });

            expect(res.statusCode).toBe(200);
            expect(res.text).toBe('OK');
            expect(orderRepository.markAsPaidIfPending).not.toHaveBeenCalled();
        });

        it('should mark order as Paid using markAsPaidIfPending, set status to Processing, and save gatewayTransactionId without modifying transactionId on success', async () => {
            const responseData = {
                code: 'PAYMENT_SUCCESS',
                data: {
                    merchantTransactionId: 'JGM-9d4e5f-12345',
                    amount: 10000, // Rs 100 in paise
                    transactionId: 'T123456789'
                }
            };
            const { base64Response, checksum } = generateWebhookPayload(responseData, 'TEST_SALT_KEY', '1');
            orderRepository.findByTransactionId.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                totalPrice: 100, // Rs 100
                transactionId: 'JGM-9d4e5f-12345'
            });
            orderRepository.markAsPaidIfPending.mockResolvedValue(true);

            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', checksum)
                .send({ response: base64Response });

            expect(res.statusCode).toBe(200);
            expect(res.text).toBe('OK');
            
            // Check that we update order successfully via the conditional helper
            expect(orderRepository.markAsPaidIfPending).toHaveBeenCalledWith('order123', {
                paymentStatus: 'Paid',
                status: 'Processing',
                gatewayTransactionId: 'T123456789'
            });
        });

        it('should atomically cancel and restore stock if response indicates failure', async () => {
            const responseData = {
                code: 'PAYMENT_ERROR',
                data: {
                    merchantTransactionId: 'JGM-9d4e5f-12345',
                    amount: 10000,
                    transactionId: 'T123456789'
                }
            };
            const { base64Response, checksum } = generateWebhookPayload(responseData, 'TEST_SALT_KEY', '1');
            orderRepository.findByTransactionId.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                totalPrice: 100,
                status: 'Pending'
            });

            const res = await request(app)
                .post('/api/v1/payments/webhook')
                .set('x-verify', checksum)
                .send({ response: base64Response });

            expect(res.statusCode).toBe(200);
            expect(res.text).toBe('OK');

            expect(orderRepository.cancelAndRestoreStock).toHaveBeenCalledWith('order123');
        });
    });

    describe('GET /api/v1/payments/check-status/:orderId', () => {
        it('should return 404 if order is not found', async () => {
            orderRepository.findById.mockResolvedValue(null);

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(404);
            expect(res.body.message).toBe('Order not found');
        });

        it('should return immediate state if order is already processed (Paid)', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Paid',
                status: 'Processing'
            });

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ paymentStatus: 'Paid', orderStatus: 'Processing' });
            expect(axios.get).not.toHaveBeenCalled();
        });

        it('should cancel order and restore stock atomically if order has no transactionId', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                status: 'Pending',
                transactionId: null
            });

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ paymentStatus: 'Failed', orderStatus: 'Cancelled' });

            expect(orderRepository.cancelAndRestoreStock).toHaveBeenCalledWith('order123');
        });

        it('should catch Axios exceptions gracefully and return Pending status without canceling the order', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                totalPrice: 200,
                status: 'Pending',
                transactionId: 'JGM-9d4e5f-12345'
            });

            axios.get.mockRejectedValue(new Error('Connection timed out'));

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({
                paymentStatus: 'Pending',
                orderStatus: 'Pending',
                note: 'Gateway synchronizing state.'
            });

            expect(orderRepository.cancelAndRestoreStock).not.toHaveBeenCalled();
            expect(orderRepository.markAsPaidIfPending).not.toHaveBeenCalled();
        });

        it('should return Paid status and save gatewayTransactionId using markAsPaidIfPending if PhonePe responds with PAYMENT_SUCCESS', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                totalPrice: 200,
                status: 'Pending',
                transactionId: 'JGM-9d4e5f-12345'
            });
            
            axios.get.mockResolvedValue({
                data: {
                    code: 'PAYMENT_SUCCESS',
                    data: {
                        amount: 20000,
                        transactionId: 'T987654321'
                    }
                }
            });

            orderRepository.markAsPaidIfPending.mockResolvedValue(true);

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ paymentStatus: 'Paid', orderStatus: 'Processing' });

            expect(axios.get).toHaveBeenCalledTimes(1);
            expect(axios.get.mock.calls[0][0]).toContain('/pg/v1/status/TEST_MERCHANT_ID/JGM-9d4e5f-12345');
            expect(axios.get.mock.calls[0][1].headers['X-VERIFY']).toBeDefined();

            expect(orderRepository.markAsPaidIfPending).toHaveBeenCalledWith('order123', {
                paymentStatus: 'Paid',
                status: 'Processing',
                gatewayTransactionId: 'T987654321'
            });
        });

        it('should return Pending status if PhonePe responds with PAYMENT_PENDING', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                totalPrice: 200,
                status: 'Pending',
                transactionId: 'JGM-9d4e5f-12345'
            });

            axios.get.mockResolvedValue({
                data: {
                    code: 'PAYMENT_PENDING'
                }
            });

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ paymentStatus: 'Pending', orderStatus: 'Pending' });
            expect(orderRepository.markAsPaidIfPending).not.toHaveBeenCalled();
        });

        it('should restore stock atomically and set Failed/Cancelled if PhonePe responds with failure code', async () => {
            orderRepository.findById.mockResolvedValue({
                _id: 'order123',
                paymentStatus: 'Pending',
                totalPrice: 200,
                status: 'Pending',
                transactionId: 'JGM-9d4e5f-12345'
            });

            axios.get.mockResolvedValue({
                data: {
                    code: 'PAYMENT_ERROR',
                    data: {}
                }
            });

            const res = await request(app).get('/api/v1/payments/check-status/order123');
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ paymentStatus: 'Failed', orderStatus: 'Cancelled' });

            expect(orderRepository.cancelAndRestoreStock).toHaveBeenCalledWith('order123');
        });
    });
});
