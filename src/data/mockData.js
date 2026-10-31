export const serviceCatalog = [
  {
    id: 'haircut',
    name: 'Haircut',
    description: 'Clean and sharp haircut tailored to your style.',
    price: 100,
    duration: 30,
    employees: ['Rahul', 'Aman'],
    offers: ['Classic cut']
  },
  {
    id: 'shave-trim-beards',
    name: 'Shave / Trim Beards',
    description: 'Precision beard shaping and clean shave finish.',
    price: 60,
    duration: 20,
    employees: ['Siddharth', 'Kabir'],
    offers: ['Fresh look']
  },
  {
    id: 'head-massage',
    name: 'Head Massage',
    description: 'Relaxing scalp and head massage for stress relief.',
    price: 50,
    duration: 25,
    employees: ['Neha', 'Vikram'],
    offers: ['Relax mode']
  }
]

export const salons = [
  {
    id: 'velvet-studio',
    name: 'Velvet Studio',
    location: 'Banjara Hills',
    city: 'Hyderabad',
    distance: '2.1 km away',
    rating: 4.9,
    reviewCount: 840,
    priceRange: '₹₹₹',
    image:
      'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=900&q=80',
    workingHours: '9:00 AM - 10:00 PM',
    availableEmployees: 9,
    availableChairs: 6,
    features: ['Luxury grooming', 'Private bays', 'Premium products'],
    serviceIds: ['haircut', 'shave-trim-beards', 'head-massage'],
    queue: 4,
    popular: true
  },
  {
    id: 'crown-club',
    name: 'Crown Club',
    location: 'Madhapur',
    city: 'Hyderabad',
    distance: '4.6 km away',
    rating: 4.8,
    reviewCount: 610,
    priceRange: '₹₹',
    image:
      'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=900&q=80',
    workingHours: '10:00 AM - 9:30 PM',
    availableEmployees: 7,
    availableChairs: 5,
    features: ['Men’s grooming', 'Express service', 'Affordable luxury'],
    serviceIds: ['haircut', 'shave-trim-beards', 'head-massage'],
    queue: 3,
    popular: true
  },
  {
    id: 'blush-bar',
    name: 'Blush Bar & Spa',
    location: 'Gachibowli',
    city: 'Hyderabad',
    distance: '6.3 km away',
    rating: 4.7,
    reviewCount: 520,
    priceRange: '₹₹₹',
    image:
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80',
    workingHours: '8:30 AM - 9:00 PM',
    availableEmployees: 8,
    availableChairs: 7,
    features: ['Hair spa', 'Facial care', 'Gentle ambience'],
    serviceIds: ['haircut', 'shave-trim-beards', 'head-massage'],
    queue: 5,
    popular: false
  }
]

export const customerProfile = {
  fullName: 'Aarav Sharma',
  phone: '+91 98765 43210',
  email: 'aarav@booksaloon.com',
  memberSince: 'Jan 2024',
  points: 1480,
  tier: 'Gold Member'
}

export const bookings = [
  {
    id: 'BSA-2041',
    service: 'Haircut',
    salon: 'Velvet Studio',
    date: 'Today, 6:30 PM',
    barber: 'Rahul',
    chair: '02',
    status: 'Confirmed',
    amount: '₹499'
  },
  {
    id: 'BSA-2068',
    service: 'Facial',
    salon: 'Blush Bar & Spa',
    date: 'Thu, 11:00 AM',
    barber: 'Neha',
    chair: '05',
    status: 'Queued',
    amount: '₹999'
  },
  {
    id: 'BSA-2102',
    service: 'Hair Spa',
    salon: 'Velvet Studio',
    date: 'Sat, 1:00 PM',
    barber: 'Aman',
    chair: '03',
    status: 'Pending',
    amount: '₹899'
  }
]

export const offers = [
  { title: 'Monsoon Glow', discount: '25% off', desc: 'On facials and hair spa.', badge: 'Hot deal' },
  { title: 'Quick Turn', discount: 'Free beard oil', desc: 'Instant booking within 15 mins.', badge: 'New' },
  { title: 'Couple Care', discount: 'Buy 1 get 1', desc: 'On hair styling and massages.', badge: 'Popular' }
]

export const notifications = [
  { title: 'Your queue is moving', body: 'You are 3rd in line at Velvet Studio.', time: '2 min ago', icon: 'clock' },
  { title: 'New offer unlocked', body: '20% off on hair spa this weekend.', time: '15 min ago', icon: 'sparkles' },
  { title: 'Appointment reminder', body: 'Your haircut is confirmed for 6:30 PM today.', time: '1 hour ago', icon: 'bell' }
]

export const adminMetrics = {
  todayRevenue: '₹52,480',
  appointments: 128,
  satisfaction: '4.9/5',
  activeStaff: 18,
  queueLoad: '68%'
}
