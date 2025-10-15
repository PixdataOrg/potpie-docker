#!/usr/bin/env node

/**
 * Test script for Coderide Potpie Service
 * This script tests the main endpoints without requiring a real Potpie API key
 */

const axios = require('axios');

const BASE_URL = process.env.TEST_URL || 'http://localhost:8080';

async function testHealthCheck() {
  console.log('🔍 Testing health check endpoint...');
  try {
    const response = await axios.get(`${BASE_URL}/`);
    console.log('✅ Health check passed:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function testDetailedHealth() {
  console.log('🔍 Testing detailed health endpoint...');
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Detailed health check passed:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Detailed health check failed:', error.message);
    return false;
  }
}

async function testAnalyzeEndpoint() {
  console.log('🔍 Testing analyze endpoint (will fail without valid API key)...');
  try {
    const response = await axios.post(`${BASE_URL}/analyze`, {
      repo: 'test-org/test-repo',
      branch: 'main',
      question: 'Test question'
    });
    console.log('✅ Analyze endpoint response:', response.data);
    return true;
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 500) {
      console.log('⚠️  Analyze endpoint correctly requires valid Potpie API key');
      return true;
    }
    console.error('❌ Analyze endpoint failed unexpectedly:', error.message);
    return false;
  }
}

async function testStatusEndpoint() {
  console.log('🔍 Testing status endpoint...');
  try {
    const response = await axios.get(`${BASE_URL}/status/test-project-id`);
    console.log('✅ Status endpoint response:', response.data);
    return true;
  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 500) {
      console.log('⚠️  Status endpoint correctly requires valid Potpie API key');
      return true;
    }
    console.error('❌ Status endpoint failed unexpectedly:', error.message);
    return false;
  }
}

async function test404Handler() {
  console.log('🔍 Testing 404 handler...');
  try {
    const response = await axios.get(`${BASE_URL}/nonexistent-endpoint`);
    console.error('❌ 404 handler failed - should have returned 404');
    return false;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('✅ 404 handler working correctly:', error.response.data);
      return true;
    }
    console.error('❌ 404 handler failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log(`🚀 Starting tests for Coderide Potpie Service at ${BASE_URL}\n`);
  
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Detailed Health', fn: testDetailedHealth },
    { name: 'Analyze Endpoint', fn: testAnalyzeEndpoint },
    { name: 'Status Endpoint', fn: testStatusEndpoint },
    { name: '404 Handler', fn: test404Handler }
  ];

  let passed = 0;
  let total = tests.length;

  for (const test of tests) {
    console.log(`\n--- ${test.name} ---`);
    const result = await test.fn();
    if (result) {
      passed++;
    }
    await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between tests
  }

  console.log(`\n📊 Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Service is working correctly.');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check the logs above.');
    process.exit(1);
  }
}

// Handle command line arguments
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Usage: node test-service.js [options]

Options:
  --help, -h     Show this help message
  
Environment Variables:
  TEST_URL       Base URL for testing (default: http://localhost:8080)
  
Examples:
  node test-service.js                           # Test local service
  TEST_URL=https://potpie.coderide.dev node test-service.js  # Test remote service
`);
  process.exit(0);
}

// Run tests
runTests().catch(error => {
  console.error('💥 Test runner failed:', error.message);
  process.exit(1);
});
