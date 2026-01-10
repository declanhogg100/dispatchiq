// Quick diagnostic to check Supabase configuration
// Run with: node scripts/check-supabase-env.js

require('dotenv').config({ path: '.env.local' });

console.log('🔍 Checking Supabase Environment Variables\n');

const checks = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', value: process.env.NEXT_PUBLIC_SUPABASE_URL },
  { name: 'SUPABASE_URL (fallback)', value: process.env.SUPABASE_URL },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', value: process.env.SUPABASE_SERVICE_ROLE_KEY },
];

let allGood = true;

checks.forEach(check => {
  if (check.value) {
    const preview = check.value.substring(0, 30) + '...';
    console.log(`✅ ${check.name}: ${preview}`);
  } else {
    console.log(`❌ ${check.name}: NOT SET`);
    if (check.name.includes('fallback')) {
      // Fallback is optional
    } else {
      allGood = false;
    }
  }
});

console.log('\n' + '='.repeat(50));

if (allGood) {
  console.log('✅ All required Supabase variables are set!');
  console.log('\nYou can now restart your server:');
  console.log('  npm run dev:server');
} else {
  console.log('❌ Missing required Supabase variables!');
  console.log('\nAdd these to your .env.local file:');
  console.log('  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co');
  console.log('  NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key');
  console.log('  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
}

