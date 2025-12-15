
import { StandardCheckoutClient, Env } from 'pg-sdk-node';

const client = StandardCheckoutClient.getInstance(
  'TESTID', 'TESTSECRET', 1, Env.SANDBOX
);

console.log('getTransactionStatus:', client.getTransactionStatus.toString());
console.log('getOrderStatus:', client.getOrderStatus.toString());
