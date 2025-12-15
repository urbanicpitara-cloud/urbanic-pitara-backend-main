
import { StandardCheckoutClient, Env } from 'pg-sdk-node';

const client = StandardCheckoutClient.getInstance(
  'TESTID', 'TESTSECRET', 1, Env.SANDBOX
);

console.log('Client Methods:', Object.getPrototypeOf(client));
console.log('Client Properties:', Object.keys(client));
