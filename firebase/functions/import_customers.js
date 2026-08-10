// import_customers.js
// Script to import customers from customer.csv into Firestore
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Try to load service account for local dev, fallback to default credentials
let adminConfig = {};
const serviceAccountPath = path.join(__dirname, 'secrets', 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath)) {
  adminConfig.credential = admin.credential.cert(require(serviceAccountPath));
  console.log('Using local service account from secrets/serviceAccountKey.json for Firebase Admin SDK.');
} else {
  console.log('Using default credentials for Firebase Admin SDK.');
}
admin.initializeApp(adminConfig);
const db = admin.firestore();

const csvFilePath = path.join(__dirname, 'data', 'customer.csv');

function importCustomers() {
  const customers = [];
  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      customers.push(row);
    })
    .on('end', async () => {
      console.log(`Read ${customers.length} customers from CSV.`);
      for (const customer of customers) {
        // Customize mapping as needed
        await db.collection('customers').add({
          ...customer,
          importedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      console.log('Import complete.');
    });
}

importCustomers();
