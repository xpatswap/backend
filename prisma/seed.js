const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const BRAND_CATALOG = [
  { name: 'Apple', colorHex: '#3a3c41', categories: [
    { name: 'iPhone', icon: 'phone' }, { name: 'MacBook', icon: 'laptop' }, { name: 'iPad', icon: 'tablet' },
    { name: 'iWatch', icon: 'watch' }, { name: 'AirPods', icon: 'buds' },
  ]},
  { name: 'Samsung', colorHex: '#1c2a4a', categories: [
    { name: 'Phone', icon: 'phone' }, { name: 'Tablet', icon: 'tablet' }, { name: 'Watch', icon: 'watch' }, { name: 'Buds', icon: 'buds' },
  ]},
  { name: 'Infinix', colorHex: '#1f3b2a', categories: [{ name: 'Phone', icon: 'phone' }, { name: 'Buds', icon: 'buds' }]},
  { name: 'Tecno', colorHex: '#1b2e3f', categories: [{ name: 'Phone', icon: 'phone' }, { name: 'Buds', icon: 'buds' }]},
  { name: 'Itel', colorHex: '#3a2e1a', categories: [{ name: 'Phone', icon: 'phone' }, { name: 'Buds', icon: 'buds' }]},
  { name: 'Redmi', colorHex: '#3a2020', categories: [
    { name: 'Phone', icon: 'phone' }, { name: 'Tablet', icon: 'tablet' }, { name: 'Buds', icon: 'buds' }, { name: 'Watch', icon: 'watch' },
  ]},
  { name: 'Oppo', colorHex: '#2a1f3a', categories: [{ name: 'Phone', icon: 'phone' }, { name: 'Buds', icon: 'buds' }, { name: 'Watch', icon: 'watch' }]},
  { name: 'Vivo', colorHex: '#1a2a3a', categories: [{ name: 'Phone', icon: 'phone' }, { name: 'Buds', icon: 'buds' }]},
  { name: 'Honor', colorHex: '#1f2530', categories: [
    { name: 'Phone', icon: 'phone' }, { name: 'Tablet', icon: 'tablet' }, { name: 'Watch', icon: 'watch' }, { name: 'Buds', icon: 'buds' },
  ]},
];

const COMMUNITIES = [
  { state: 'Lagos Swappers', region: 'Lagos State' },
  { state: 'Abuja Swappers', region: 'FCT, Abuja' },
  { state: 'Port Harcourt Swappers', region: 'Rivers State' },
  { state: 'Kano Swappers', region: 'Kano State' },
  { state: 'Ibadan Swappers', region: 'Oyo State' },
  { state: 'Benin City Swappers', region: 'Edo State' },
  { state: 'Enugu Swappers', region: 'Enugu State' },
  { state: 'Kaduna Swappers', region: 'Kaduna State' },
  { state: 'Jos Swappers', region: 'Plateau State' },
  { state: 'Calabar Swappers', region: 'Cross River State' },
  { state: 'Uyo Swappers', region: 'Akwa Ibom State' },
  { state: 'Asaba Swappers', region: 'Delta State' },
  { state: 'Owerri Swappers', region: 'Imo State' },
  { state: 'Abeokuta Swappers', region: 'Ogun State' },
  { state: 'Akure Swappers', region: 'Ondo State' },
  { state: 'Osogbo Swappers', region: 'Osun State' },
  { state: 'Ilorin Swappers', region: 'Kwara State' },
  { state: 'Sokoto Swappers', region: 'Sokoto State' },
  { state: 'Maiduguri Swappers', region: 'Borno State' },
  { state: 'Bauchi Swappers', region: 'Bauchi State' },
  { state: 'Gombe Swappers', region: 'Gombe State' },
  { state: 'Yola Swappers', region: 'Adamawa State' },
  { state: 'Jalingo Swappers', region: 'Taraba State' },
  { state: 'Lafia Swappers', region: 'Nasarawa State' },
  { state: 'Minna Swappers', region: 'Niger State' },
  { state: 'Lokoja Swappers', region: 'Kogi State' },
  { state: 'Makurdi Swappers', region: 'Benue State' },
  { state: 'Awka Swappers', region: 'Anambra State' },
  { state: 'Abakaliki Swappers', region: 'Ebonyi State' },
  { state: 'Umuahia Swappers', region: 'Abia State' },
  { state: 'Yenagoa Swappers', region: 'Bayelsa State' },
  { state: 'Birnin Kebbi Swappers', region: 'Kebbi State' },
  { state: 'Gusau Swappers', region: 'Zamfara State' },
  { state: 'Katsina Swappers', region: 'Katsina State' },
  { state: 'Dutse Swappers', region: 'Jigawa State' },
  { state: 'Damaturu Swappers', region: 'Yobe State' },
  { state: 'Ado Ekiti Swappers', region: 'Ekiti State' },
];

async function main() {
  console.log('Seeding brands + categories...');
  for (const b of BRAND_CATALOG) {
    const brand = await prisma.brand.upsert({
      where: { name: b.name },
      update: { colorHex: b.colorHex },
      create: { name: b.name, colorHex: b.colorHex },
    });
    for (const c of b.categories) {
      await prisma.category.upsert({
        where: { brandId_name: { brandId: brand.id, name: c.name } },
        update: { icon: c.icon },
        create: { brandId: brand.id, name: c.name, icon: c.icon },
      });
    }
  }

  console.log('Seeding all 36 states + FCT communities...');
  for (const c of COMMUNITIES) {
    await prisma.community.upsert({
      where: { state: c.state },
      update: { region: c.region },
      create: { state: c.state, region: c.region },
    });
  }

  console.log('Seeding default admin account...');
  const adminPasswordHash = await bcrypt.hash('ChangeMe123!', 12);
  await prisma.admin.upsert({
    where: { email: 'admin@xpatswap.com' },
    update: {},
    create: {
      email: 'admin@xpatswap.com',
      passwordHash: adminPasswordHash,
      fullName: 'Xpatswap Admin',
      role: 'SUPER_ADMIN',
    },
  });
  console.log('  -> Default admin: admin@xpatswap.com / ChangeMe123!  (change this immediately)');

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
