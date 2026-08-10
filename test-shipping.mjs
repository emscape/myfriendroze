#!/usr/bin/env node

const result = await fetch('http://localhost:4321/api/shipping', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ zipCode: '90293', weight: 3.45 })
});

const body = await result.text();
console.log('Status:', result.status);
console.log('Response:', body);
