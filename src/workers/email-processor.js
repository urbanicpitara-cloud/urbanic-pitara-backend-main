import { Worker } from 'bullmq';
import { redisClient } from '../lib/redis.js';
import emailService from '../lib/email.js';

/**
 * Email Processing Worker
 * Sends emails in the background
 */
export const emailWorker = redisClient
  ? new Worker(
      'emails',
      async (job) => {
        const { type, payload } = job.data;
        
        console.log(`📧 Processing email job ${job.id} (Type: ${type})...`);

        try {
          switch (type) {
            case 'order-confirmation':
              await emailService.sendOrderConfirmationEmail(payload.order);
              break;
            case 'owner-notification':
              await emailService.sendOwnerOrderNotification(payload.order);
              break;
            case 'welcome':
              await emailService.sendWelcomeEmail(payload.user);
              break;
            case 'password-reset':
              await emailService.sendPasswordResetEmail(payload.user, payload.resetLink);
              break;
            case 'admin-generated-password':
              await emailService.sendAdminGeneratedPasswordEmail(payload.user, payload.newPassword);
              break;
            case 'custom':
              await emailService.sendCustomEmail(payload);
              break;
            default:
              console.warn(`⚠️ Unknown email type: ${type}`);
          }
        } catch (error) {
          console.error(`❌ Email processing failed for job ${job.id}:`, error);
          throw error; // BullMQ will retry
        }
      },
      {
        connection: redisClient,
        concurrency: 10, // Process up to 10 emails simultaneously
        limiter: {
          max: 100, // Max 100 emails per minute (Resend rate limits)
          duration: 60000,
        },
      }
    )
  : null;

// Worker event handlers
let lastEmailWorkerErrorLog = 0;
const EMAIL_WORKER_ERROR_LOG_INTERVAL = 30000;

if (emailWorker) {
  emailWorker.on('completed', (job) => {
    console.log(`✅ Email job ${job.id} completed`);
  });

  emailWorker.on('failed', (job, err) => {
    console.error(`❌ Email job ${job?.id} failed:`, err.message);
  });

  emailWorker.on('error', (err) => {
    const now = Date.now();
    if (now - lastEmailWorkerErrorLog > EMAIL_WORKER_ERROR_LOG_INTERVAL) {
      console.error('Email worker error:', err.message);
      lastEmailWorkerErrorLog = now;
    }
  });
}

export default emailWorker;
