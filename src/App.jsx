import { Component, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  CheckCircle2,
  Coffee,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  LogOut,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  Users,
  WalletCards,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router-dom'
import { customerProfile, offers, salons, serviceCatalog } from './data/mockData'
import { issueAdminSession, revokeAdminSession, validateAdminSession } from './lib/adminService'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { initializeAndroidNotifications, publishQueueNotification, requestAndroidNotificationPermission } from './services/platformNotificationAdapter'
import FrontendLandingPage from '../frontend/src/components/LandingPage'
import LiveQueueTracker from './components/queue/LiveQueueTracker'

const formatCurrency = (value) => `₹${value.toLocaleString('en-IN')}`
const INDIAN_PHONE_PATTERN = /^[6-9]\d{9}$/

function formatIndianPhone(phoneDigits) {
  return `+91${phoneDigits}`
}

function getAuthEmail(phone) {
  return `phone-${phone.replace('+91', '')}@booksaloon.app`
}

function getAdminAuthEmail(phone) {
  return `${phone.replace('+91', '')}@booksaloon.app`
}

function validateIndianPhone(phoneDigits) {
  if (!INDIAN_PHONE_PATTERN.test(phoneDigits)) {
    throw new Error('Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.')
  }
}

function getErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof Error && error.message) return error.message
  if (typeof error?.message === 'string' && error.message) return error.message
  return fallback
}

function getIndiaGreeting() {
  const hour = Number(new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date()))

  if (hour < 12) return 'Good morning,'
  if (hour < 17) return 'Good afternoon,'
  if (hour < 21) return 'Good evening,'
  return 'Good night,'
}

const navItems = [
  { label: 'Home', to: '/customer/home' },
  { label: 'My Bookings', to: '/customer/bookings' },
  { label: 'Notifications', to: '/customer/notifications' },
  { label: 'Profile', to: '/customer/profile' },
]

function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-600 via-indigo-500 to-fuchsia-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_20px_40px_rgba(91,65,255,0.35)] transition hover:translate-y-[-1px] hover:shadow-[0_24px_48px_rgba(91,65,255,0.45)] ${className}`}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-700 backdrop-blur-sm transition hover:border-slate-300 hover:bg-white ${className}`}
    >
      {children}
    </button>
  )
}

function LandingHeader({ onAction }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1220]/90 text-white backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:gap-6 sm:px-5 sm:py-4 lg:px-8">
        <div className="order-4 ml-auto flex shrink-0 items-center gap-1 sm:order-3 sm:gap-2">
          <button type="button" onClick={() => onAction('/login')} className="rounded-full px-2 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 sm:px-3 sm:text-sm">
            Login
          </button>
          <button type="button" onClick={() => onAction('/register')} className="rounded-full bg-[#d9b78c] px-3 py-2 text-xs font-bold text-[#0b1220] transition hover:bg-[#e7cda9] sm:px-4 sm:text-sm">
            Register
          </button>
        </div>
        <Link
          to="/"
          aria-label="Go to the BOOKSALOON landing page"
          className="order-3 flex w-full items-center justify-center gap-3 text-left sm:order-1 sm:w-auto sm:justify-start"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#d9b78c] text-[#0b1220] sm:h-10 sm:w-10">
            <Scissors size={19} />
          </div>
          <div>
            <p className="text-base font-black tracking-[-0.06em] sm:text-lg">BOOKSALOON</p>
            <p className="text-[9px] uppercase tracking-[0.16em] text-slate-400 sm:text-[10px] sm:tracking-[0.2em]">Salon intelligence</p>
          </div>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-slate-300 sm:order-2 lg:flex">
          {[
            ['Home', 'home'],
            ['Services', 'services'],
            ['Quick Turn', 'quick-turn'],
            ['How It Works', 'how-it-works'],
            ['Offers', 'offers'],
          ].map(([label, id]) => (
            <a key={id} href={`#${id}`} className="transition hover:text-white">{label}</a>
          ))}
        </nav>

        <div className="order-5 flex items-center gap-2 sm:order-4">
          <button type="button" onClick={() => onAction('/register')} className="hidden rounded-full border border-[#d9b78c]/50 px-4 py-2 text-sm font-semibold text-[#f0d7b2] transition hover:bg-[#d9b78c]/10 lg:inline-flex">
            Book Appointment
          </button>
          <button type="button" onClick={() => setMenuOpen((value) => !value)} className="ml-1 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 lg:hidden" aria-label="Toggle menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-white/10 px-5 py-4 lg:hidden">
          <div className="grid gap-3 text-sm text-slate-300">
            {[
              ['Home', 'home'],
              ['Services', 'services'],
              ['Quick Turn', 'quick-turn'],
              ['How It Works', 'how-it-works'],
              ['Offers', 'offers'],
            ].map(([label, id]) => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}>{label}</a>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}

function LandingPage() {
  const navigate = useNavigate()
  const [, setAdminClickCount] = useState(0)
  const landingServices = [
    ...serviceCatalog,
    {
      id: 'facial-skin-care',
      name: 'Facial & Skin Care',
      description: 'Skin-focused care for a refreshed, polished finish.',
      price: 250,
      duration: 45,
      employees: ['Neha', 'Riya'],
      offers: ['Glow care'],
    },
  ]
  const goToAuth = (path) => navigate(path, { state: { from: '/customer/home', intent: path === '/register' ? 'register' : 'booking' } })
  const handleFooterBrandClick = () => {
    setAdminClickCount((count) => {
      const nextCount = count + 1
      if (nextCount === 10) {
        navigate('/admin/login')
        return 0
      }
      return nextCount
    })
  }

  return (
    <div className="min-h-screen bg-[#f7f4ef] text-[#172033]">
      <LandingHeader onAction={goToAuth} />

      <main>
        <section id="home" className="relative overflow-hidden bg-[#0b1220] text-white">
          <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#b48a5a]/20 blur-3xl" />
          <div className="absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(217,183,140,0.2),transparent_58%)]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:gap-12 sm:px-5 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-28">
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <p className="mb-5 text-xs font-bold uppercase tracking-[0.28em] text-[#d9b78c]">A better way to book your time</p>
              <h1 className="max-w-3xl text-4xl font-black leading-[0.98] tracking-[-0.08em] sm:text-7xl">
                Your Style.<br />Your Time.<br /><span className="text-[#d9b78c]">Your Turn.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                Book your salon visit in a few taps. Know the price, choose your service and spend less time waiting.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => goToAuth('/register')} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#d9b78c] px-6 py-3.5 text-sm font-bold text-[#0b1220] transition hover:bg-[#e7cda9]">
                  Book your appointment <ArrowRight size={16} />
                </button>
                <a href="#services" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10">
                  Explore services
                </a>
              </div>
              <div className="mt-10 flex flex-wrap gap-6 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-[#d9b78c]" /> Clear pricing</span>
                <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-[#d9b78c]" /> Less waiting</span>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }} className="relative">
              <div className="overflow-hidden rounded-[36px] border border-white/15 bg-white/10 p-2 shadow-2xl shadow-black/30">
                <img src={salons[0].image} alt="Premium salon interior" className="h-[340px] w-full rounded-[30px] object-cover sm:h-[500px]" />
              </div>
              <div className="absolute -bottom-5 left-5 right-5 rounded-3xl border border-white/15 bg-[#111b2d]/95 p-4 shadow-xl backdrop-blur sm:left-auto sm:w-72">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Next available</p>
                    <p className="mt-1 text-lg font-bold">Quick Turn</p>
                  </div>
                  <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">Demo preview</span>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-slate-300">
                  <span className="inline-flex items-center gap-2"><Clock3 size={15} /> Around 15 min</span>
                  <ArrowRight size={16} className="text-[#d9b78c]" />
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section id="services" className="mx-auto max-w-7xl px-4 py-16 sm:px-5 sm:py-20 lg:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#a06f3e]">Made for your routine</p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.07em] sm:text-5xl">Everything your look needs.</h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-slate-500">Choose a service, compare what matters and book with confidence. More services can be loaded per salon from Supabase.</p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {landingServices.map((service, index) => (
              <motion.article key={service.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: index * 0.06 }} className="group rounded-[28px] border border-[#e7dfd4] bg-white p-5 shadow-[0_18px_40px_rgba(74,54,34,0.06)] transition hover:-translate-y-1">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2e7d8] text-[#9b6b3d]">
                  {index === 0 ? <Scissors size={21} /> : index === 1 ? <UserRound size={21} /> : index === 2 ? <Sparkles size={21} /> : <Star size={21} />}
                </div>
                <h3 className="mt-7 text-xl font-black tracking-[-0.05em]">{index === 0 ? 'Haircut & Styling' : index === 1 ? 'Beard & Grooming' : index === 2 ? 'Hair Spa' : 'Facial & Skin Care'}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{service.description}</p>
                <div className="mt-6 flex items-end justify-between border-t border-slate-100 pt-4">
                  <div><p className="text-lg font-black">₹{service.price}</p><p className="text-xs text-slate-400">{service.duration} mins</p></div>
                  <button type="button" onClick={() => goToAuth('/register')} className="rounded-full bg-[#172033] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#2b3a54]">Book now</button>
                </div>
              </motion.article>
            ))}
          </div>
        </section>

        <section id="quick-turn" className="bg-[#172033] px-4 py-16 text-white sm:px-5 sm:py-20 lg:px-8">
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#d9b78c]">Skip the calendar</p>
              <h2 className="mt-3 text-3xl font-black tracking-[-0.07em] sm:text-5xl">Need a cut now?<br /><span className="text-[#d9b78c]">Take the next turn.</span></h2>
              <p className="mt-5 max-w-lg leading-7 text-slate-300">Quick Turn connects you to the next available barber. See the estimated wait, claim your queue token and arrive when it is your time.</p>
              <button type="button" onClick={() => goToAuth('/register')} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#d9b78c] px-6 py-3.5 text-sm font-bold text-[#0b1220]">Book Quick Turn <ArrowRight size={16} /></button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['01', 'Next available barber', 'Choose the next expert instead of a fixed slot.'],
                ['15 min', 'Estimated wait', 'A transparent estimate before you join.'],
                ['Q-04', 'Queue token', 'Track your turn as the queue moves.'],
              ].map(([value, title, body]) => (
                <div key={title} className="rounded-[26px] border border-white/10 bg-white/5 p-5">
                  <p className="text-3xl font-black tracking-[-0.08em] text-[#d9b78c]">{value}</p>
                  <p className="mt-8 font-bold">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
                  <p className="mt-5 text-[10px] uppercase tracking-[0.16em] text-amber-300">Demo preview</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-16 sm:px-5 sm:py-20 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#a06f3e]">Simple by design</p>
            <h2 className="mt-3 text-3xl font-black tracking-[-0.07em] sm:text-5xl">Three steps to a better visit.</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ['01', 'Choose your service', 'See clear prices, durations and available experts in one place.'],
              ['02', 'Book or take Quick Turn', 'Reserve a time or join the next available queue.'],
              ['03', 'Arrive right on time', 'Track your booking and spend less time in the waiting area.'],
            ].map(([number, title, body]) => (
              <div key={number} className="rounded-[28px] border border-[#e7dfd4] bg-[#fbf9f6] p-6">
                <span className="text-sm font-black text-[#a06f3e]">{number}</span>
                <h3 className="mt-12 text-2xl font-black tracking-[-0.06em]">{title}</h3>
                <p className="mt-3 leading-7 text-slate-500">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="offers" className="bg-[#efe7dc] px-4 py-16 sm:px-5 sm:py-20 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-[#a06f3e]">Coming soon</p><h2 className="mt-3 text-4xl font-black tracking-[-0.07em]">Offers worth waiting for.</h2></div>
              <span className="hidden rounded-full bg-white/70 px-3 py-2 text-xs font-semibold text-slate-500 sm:block">Salon-specific offers</span>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3 blur-sm">
              {offers.map((offer) => <div key={offer.title} className="rounded-[26px] border border-white/70 bg-white/70 p-5"><span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#a06f3e]">{offer.badge}</span><h3 className="mt-8 text-2xl font-black">{offer.title}</h3><p className="mt-2 text-lg font-bold text-[#a06f3e]">{offer.discount}</p><p className="mt-2 text-sm text-slate-500">{offer.desc}</p></div>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-5 sm:py-20 lg:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              [WalletCards, 'Transparent pricing', 'Know what you will pay before you confirm.'],
              [CalendarCheck2, 'Easy appointment booking', 'Find the right service and slot in a few taps.'],
              [Clock3, 'Less waiting time', 'Quick Turn and queue tracking keep your day moving.'],
            ].map(([Icon, title, body]) => <div key={title} className="rounded-[28px] bg-white p-6 shadow-[0_18px_40px_rgba(74,54,34,0.06)]"><Icon className="text-[#a06f3e]" size={22} /><h3 className="mt-8 text-xl font-black">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{body}</p></div>)}
          </div>
        </section>
      </main>

      <footer className="bg-[#0b1220] px-4 py-10 text-slate-400 sm:px-5 sm:py-12 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <button type="button" onClick={handleFooterBrandClick} className="text-xl font-black tracking-[-0.06em] text-white">
              BOOKSALOON
            </button>
            <p className="mt-3 max-w-xs text-sm leading-6">A calmer, clearer way to manage every salon visit.</p>
          </div>
          <div><p className="text-sm font-bold text-white">Explore</p><div className="mt-4 grid gap-2 text-sm"><a href="#services">Services</a><a href="#quick-turn">Quick Turn</a><a href="#how-it-works">How it works</a><a href="#offers">Offers</a></div></div>
          <div><p className="text-sm font-bold text-white">Account</p><div className="mt-4 grid gap-2 text-sm"><button type="button" onClick={() => goToAuth('/login')} className="text-left">Login</button><button type="button" onClick={() => goToAuth('/register')} className="text-left">Register</button><span>Privacy & terms</span></div></div>
        </div>
        <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-5 text-xs">© 2026 BOOKSALOON. Salon details and offers are loaded per tenant.</div>
      </footer>
    </div>
  )
}

function AppHeader({ title, subtitle, userName, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-30 border-b border-white/70 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link
          to="/customer/home"
          aria-label="Go to the BOOKSALOON home screen"
          className="flex items-center gap-3 text-left"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
            <Scissors size={18} />
          </span>
          <div>
            <p className="text-lg font-black tracking-[-0.06em] text-slate-900">BOOKSALOON</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </Link>

        <div className="hidden items-center gap-3 md:flex">
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {userName}
          </div>
          <button
            type="button"
            onClick={() => navigate('/customer/notifications')}
            aria-label="Open notifications"
            title="Notifications"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
          >
            <Bell size={18} />
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>

        <div className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-label="Open account menu"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
          >
            <Menu size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-14 z-50 w-40 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={onLogout}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <LogOut size={15} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function BottomNavigation() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
        {navItems.map(({ label, to }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium leading-tight transition ${
                isActive
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-lg shadow-violet-500/30'
                  : 'text-slate-500 hover:bg-slate-100'
              }`
            }
          >
            <span className="h-5 w-5">
              {label === 'Home' && <Bell size={18} />}
              {label === 'My Bookings' && <CalendarCheck2 size={18} />}
              {label === 'Notifications' && <Bell size={18} />}
              {label === 'Profile' && <UserRound size={18} />}
            </span>
            <span className="whitespace-nowrap">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f5f3ff_0%,#f8fafc_35%,#edf2ff_100%)]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-16 w-16 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
        <div className="text-center">
          <p className="text-lg font-bold tracking-[-0.08em] text-slate-900">BOOKSALOON</p>
          <p className="text-sm text-slate-500">Loading your salon experience...</p>
        </div>
      </div>
    </div>
  )
}

class AppErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('BOOKSALOON application error:', error)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-xl">
          <h1 className="text-xl font-black text-slate-900">BOOKSALOON needs a refresh</h1>
          <p className="mt-2 text-sm text-slate-500">Your session may have expired. Reload the page to continue.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white">
            Reload website
          </button>
        </div>
      </div>
    )
  }
}

function StatusBadge({ status }) {
  const colorMap = {
    Confirmed: 'bg-emerald-100 text-emerald-700',
    Queued: 'bg-amber-100 text-amber-700',
    Pending: 'bg-slate-200 text-slate-700',
  }

  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${colorMap[status] || 'bg-slate-200 text-slate-700'}`}>
      {status}
    </span>
  )
}

function SalonCard({ salon, compact = false }) {
  return (
    <Link
      to={`/customer/salon/${salon.id}`}
      className={`group overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_40px_rgba(15,23,42,0.06)] transition hover:-translate-y-1 ${compact ? 'p-2' : 'p-3'}`}
    >
      <div className="relative overflow-hidden rounded-[22px]">
        <img src={salon.image} alt={salon.name} className="h-52 w-full object-cover transition duration-500 group-hover:scale-105" />
        <div className="absolute inset-x-2 top-2 flex items-center justify-between">
          <span className="rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-slate-700 backdrop-blur">
            {salon.priceRange}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/85 px-2 py-1 text-[10px] font-semibold text-white">
            <Star size={10} fill="currentColor" />
            {salon.rating}
          </span>
        </div>
      </div>
      <div className="space-y-2 p-2 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{salon.name}</h3>
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
              <MapPin size={14} />
              {salon.location}
            </p>
          </div>
          <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">
            {salon.distance}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{salon.workingHours}</span>
          <span className="mx-1 h-1 w-1 rounded-full bg-slate-300" />
          <span>{salon.availableEmployees} stylists</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {salon.features.slice(0, 2).map((feature) => (
            <span key={feature} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
              {feature}
            </span>
          ))}
        </div>
      </div>
    </Link>
  )
}

function ServiceCard({ service }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-slate-900">{service.name}</p>
          <p className="mt-1 text-sm text-slate-500">{service.description}</p>
        </div>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">
          {service.offers[0]}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>{service.duration} mins</span>
        <span>{service.employees.length} experts</span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xl font-black tracking-[-0.06em] text-slate-900">{formatCurrency(service.price)}</span>
        <button type="button" className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-slate-900/15">
          Add
        </button>
      </div>
    </div>
  )
}

function BookingCard({ booking }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-lg font-bold tracking-[-0.04em] text-slate-900">{booking.service}</p>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">{booking.salon}</p>
        </div>
        <p className="text-base font-bold text-slate-900">{booking.amount}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-600">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Barber</p>
          <p className="mt-1 font-semibold text-slate-800">{booking.barber}</p>
        </div>
        {(booking.status === 'Waiting' || booking.status === 'Confirmed') && booking.bookingId && (
          <Link to={`/customer/queue/${booking.bookingId}`} className="mt-4 inline-flex rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white">
            Track live queue
          </Link>
        )}
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Date</p>
          <p className="mt-1 font-semibold text-slate-800">{booking.date}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Booking ID</p>
          <p className="mt-1 font-semibold text-slate-800">{booking.id}</p>
        </div>
      </div>
    </div>
  )
}

function NotificationCard({ notification }) {
  return (
    <div className="flex items-start gap-3 rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_16px_30px_rgba(15,23,42,0.04)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
        {notification.icon === 'bell' ? <Bell size={18} /> : notification.icon === 'clock' ? <Clock3 size={18} /> : <Sparkles size={18} />}
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-slate-900">{notification.title}</p>
          <span className="text-[11px] text-slate-400">{notification.time}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{notification.body}</p>
      </div>
    </div>
  )
}

function ProfileCard({ user }) {
  const displayName = user.fullName || 'Customer'
  return (
    <div className="rounded-[26px] border border-slate-200 bg-gradient-to-br from-slate-900 via-violet-900 to-indigo-950 p-5 text-white shadow-[0_24px_50px_rgba(79,70,229,0.3)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-lg font-bold">
            {displayName.slice(0, 1)}
          </div>
          <div>
            <p className="text-xl font-bold">{displayName}</p>
            <p className="text-sm text-violet-100">{user.tier}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 text-sm text-violet-100">
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-violet-200">Phone</p>
          <p className="mt-1 font-semibold text-white">{user.phone}</p>
        </div>
        <div className="rounded-2xl bg-white/5 p-3">
          <p className="text-violet-200">Member since</p>
          <p className="mt-1 font-semibold text-white">{user.memberSince}</p>
        </div>
      </div>
    </div>
  )
}

function ConfirmationDialog({ title, message, onClose, onConfirm, submitting = false }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          className="w-full max-w-md rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.24)]"
        >
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
            <CheckCircle2 size={28} />
          </div>
          <h3 className="text-2xl font-black tracking-[-0.08em] text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
          <div className="mt-6 flex gap-3">
            <SecondaryButton className="flex-1" onClick={onClose}>Close</SecondaryButton>
            <PrimaryButton className="flex-1" onClick={onConfirm} disabled={submitting}>{submitting ? 'Please wait...' : 'Confirm'}</PrimaryButton>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function HomePage({ userName, userId, userBookings, onBookingCreated }) {
  const navigate = useNavigate()
  const { data: serviceList = serviceCatalog, isLoading } = useQuery({
    queryKey: ['services-home'],
    queryFn: async () => {
      if (!isSupabaseConfigured) return serviceCatalog
      const { data, error } = await supabase
        .from('services')
        .select('id, name, description, price_paise, duration_minutes, is_active')
        .eq('is_active', true)
        .order('created_at')
      if (error) throw new Error(error.message)
      return (data || []).map((service) => ({
        ...service,
        price: service.price_paise / 100,
        duration: service.duration_minutes,
        offers: ['Available'],
        employees: [],
      }))
    },
  })
  const { data: salonStatus } = useQuery({
    queryKey: ['customer-salon-status'],
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase.from('salons').select('id, status').order('created_at', { ascending: true }).limit(1).single()
      if (error) throw new Error(error.message)
      return data
    },
    refetchInterval: 25000,
  })

  const [selectedServices, setSelectedServices] = useState([])
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [isPriority, setIsPriority] = useState(false)
  const [showClosedPopup, setShowClosedPopup] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [bookingSubmitting, setBookingSubmitting] = useState(false)
  const salonClosed = salonStatus?.status === 'PAUSED'

  if (isLoading) {
    return <LoadingScreen />
  }

  const addService = (service) => {
    setSelectedServices((current) => {
      const exists = current.find((item) => item.id === service.id)
      if (exists) {
        return current.filter((item) => item.id !== service.id)
      }
      return [...current, { ...service }]
    })
  }

  const total = selectedServices.reduce((sum, item) => sum + item.price, 0)
  const totalWithPriority = total + (isPriority ? 50 : 0)
  const confirmBooking = async () => {
    if (salonClosed) {
      setIsBookingOpen(false)
      setShowClosedPopup(true)
      return
    }
    if (!isSupabaseConfigured || !salonStatus?.id || !userId) {
      setBookingError('Booking is unavailable until your salon account is connected.')
      return
    }
    setBookingSubmitting(true)
    setBookingError('')
    const { data, error } = await supabase.rpc('create_auto_assigned_booking', {
      p_salon_id: salonStatus.id,
      p_service_ids: selectedServices.map((service) => service.id),
      p_priority: isPriority,
    })
    setBookingSubmitting(false)
    if (error) {
      if (error.message.includes('SALON_CLOSED')) {
        setIsBookingOpen(false)
        setShowClosedPopup(true)
      } else {
        setBookingError(error.message)
      }
      return
    }
    const result = data?.[0]
    const booking = {
      id: result.booking_id,
      bookingId: result.booking_id,
      service: selectedServices.map((service) => service.name).join(', '),
      salon: 'BOOKSALOON Demo Salon',
      amount: `₹${totalWithPriority}`,
      barber: result.employee_name,
      date: new Date(result.estimated_start_at).toLocaleDateString('en-IN'),
      status: result.booking_status === 'CONFIRMED' ? 'Confirmed' : 'Waiting',
      estimatedWait: result.estimated_wait_minutes,
    }
    onBookingCreated(booking)
    if (result.booking_status === 'WAITING') {
      await publishQueueNotification({
        title: 'The Saloon waiting time',
        body: `${result.estimated_wait_minutes ?? 0} minutes estimated wait. Tap to track your queue.`,
        bookingId: result.booking_id,
        progress: 0,
      })
    }
    setIsBookingOpen(false)
    setSelectedServices([])
    setIsPriority(false)
  }

  return (
    <div className="space-y-6 pb-24">
      <section className="rounded-[30px] bg-[radial-gradient(circle_at_top_left,#f5f3ff_0%,#eef2ff_35%,#ffffff_100%)] p-5 shadow-[0_18px_40px_rgba(79,70,229,0.08)] sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{getIndiaGreeting()}</p>
            <h1 className="mt-1 text-3xl font-black tracking-[-0.08em] text-slate-900">{userName}</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate('/customer/notifications')}
            aria-label="Open notifications"
            title="Notifications"
            className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg shadow-slate-200/80 transition hover:bg-violet-50 hover:text-violet-700"
          >
            <Bell size={18} />
            <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-rose-500" />
          </button>
        </div>

        <div className="mt-6">
          <PrimaryButton
            type="button"
            onClick={() => {
              if (salonClosed) setShowClosedPopup(true)
              else if (selectedServices.length > 0) setIsBookingOpen(true)
            }}
            disabled={selectedServices.length === 0 || salonClosed}
            className={`w-full sm:py-4 ${selectedServices.length === 0 || salonClosed ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Book Appointment <ArrowRight size={16} />
          </PrimaryButton>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-[-0.06em] text-slate-900">Available services</h2>
          <span className="text-sm text-slate-500">3 options</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {serviceList.map((service) => {
            const selected = selectedServices.some((item) => item.id === service.id)
            return (
              <div key={service.id} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-bold text-slate-900">{service.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{service.description}</p>
                  </div>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700">
                    {service.offers[0]}
                  </span>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>{service.duration} mins</span>
                  <span>{service.employees.length} experts</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xl font-black tracking-[-0.06em] text-slate-900">₹{service.price}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (salonClosed) setShowClosedPopup(true)
                      else addService(service)
                    }}
                    disabled={salonClosed}
                    className={`rounded-full px-3 py-2 text-xs font-semibold ${
                      selected ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white'
                    }`}
                  >
                    {selected ? 'Added' : 'Add'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {selectedServices.length > 0 && (
        <section className="rounded-[30px] border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 p-5 shadow-[0_18px_40px_rgba(79,70,229,0.08)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-violet-600">Selected services</p>
              <h3 className="mt-1 text-2xl font-black tracking-[-0.06em] text-slate-900">Booking summary</h3>
            </div>
            <div className="rounded-full bg-white px-3 py-2 text-sm font-bold text-violet-700 shadow-sm">
              Total ₹{totalWithPriority}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {selectedServices.map((service) => (
              <div key={service.id} className="flex items-center justify-between rounded-2xl bg-white/80 px-3 py-2 text-sm text-slate-700">
                <span>{service.name}</span>
                <span className="font-semibold">₹{service.price}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/80 px-3 py-3 text-sm text-slate-700">
            <span>Priority / Emergency</span>
            <button
              type="button"
              onClick={() => setIsPriority((value) => !value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                isPriority ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {isPriority ? 'Added +₹50' : 'Add ₹50'}
            </button>
          </div>

          <div className="mt-4 flex justify-end">
            <PrimaryButton type="button" onClick={() => salonClosed ? setShowClosedPopup(true) : setIsBookingOpen(true)} disabled={salonClosed}>
              Confirm booking
            </PrimaryButton>
          </div>
          <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
            Please reach the salon 5 minutes before your appointment time. Once your turn is called, you have 10 minutes to arrive; otherwise, your seat may be given to another customer.
          </p>
        </section>
      )}

      {isBookingOpen && (
        <ConfirmationDialog
          title="Appointment booked"
          message={`Your appointment is confirmed for ${selectedServices.map((service) => service.name).join(', ')}. Please reach 5 minutes before your appointment time. When your turn is called, you must arrive within 10 minutes or the seat may be given to another customer. ${isPriority ? 'Priority / Emergency has been added for ₹50 extra.' : 'No priority option selected.'}`}
          onClose={() => setIsBookingOpen(false)}
          onConfirm={confirmBooking}
          submitting={bookingSubmitting}
        />
      )}
      {bookingError && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{bookingError}</p>}
      {showClosedPopup && (
        <ConfirmationDialog
          title="Salon is closed"
          message="The salon is temporarily closed and cannot receive appointments right now. Please try again later."
          onClose={() => setShowClosedPopup(false)}
          onConfirm={() => setShowClosedPopup(false)}
        />
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-[-0.06em] text-slate-900">Offers</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-3 blur-sm">
          {offers.map((offer) => (
            <div key={offer.title} className="rounded-[24px] border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                  {offer.badge}
                </span>
                <Sparkles size={16} className="text-violet-600" />
              </div>
              <p className="text-lg font-black tracking-[-0.06em] text-slate-900">{offer.title}</p>
              <p className="mt-2 text-2xl font-black tracking-[-0.08em] text-violet-700">{offer.discount}</p>
              <p className="mt-2 text-sm text-slate-600">{offer.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-[-0.06em] text-slate-900">Upcoming appointments</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {userBookings.map((booking) => (
            <BookingCard key={booking.id} booking={booking} />
          ))}
          {userBookings.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No appointments booked yet.</p>}
        </div>
      </section>
    </div>
  )
}

function ExplorePage() {
  const [search, setSearch] = useState('')
  const [location, setLocation] = useState('Any area')
  const [serviceFilter, setServiceFilter] = useState('All services')
  const [priceFilter, setPriceFilter] = useState('Any price')

  const filteredSalons = useMemo(() => {
    return salons.filter((salon) => {
      const matchesSearch = salon.name.toLowerCase().includes(search.toLowerCase()) || salon.location.toLowerCase().includes(search.toLowerCase())
      const matchesLocation = location === 'Any area' || salon.location === location
      const matchesService = serviceFilter === 'All services' || salon.serviceIds.includes(serviceFilter)
      const matchesPrice =
        priceFilter === 'Any price' ||
        (priceFilter === 'Under ₹500' && salon.priceRange === '₹₹') ||
        (priceFilter === '₹500-₹1500' && salon.priceRange === '₹₹₹')

      return matchesSearch && matchesLocation && matchesService && matchesPrice
    })
  }, [search, location, serviceFilter, priceFilter])

  return (
    <div className="space-y-5 pb-24">
      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_16px_30px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <Search size={18} className="text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search salons"
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select value={location} onChange={(event) => setLocation(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none">
            <option>Any area</option>
            <option>Banjara Hills</option>
            <option>Madhapur</option>
            <option>Gachibowli</option>
          </select>
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none">
            <option>All services</option>
            <option>haircut</option>
            <option>shave-trim-beards</option>
            <option>head-massage</option>
          </select>
          <select value={priceFilter} onChange={(event) => setPriceFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none">
            <option>Any price</option>
            <option>Under ₹500</option>
            <option>₹500-₹1500</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredSalons.map((salon) => (
          <SalonCard key={salon.id} salon={salon} />
        ))}
      </div>
    </div>
  )
}

function BookingsPage({ userBookings }) {
  return (
    <div className="space-y-4 pb-24">
      {userBookings.map((booking) => (
        <BookingCard key={booking.id} booking={booking} />
      ))}
      {userBookings.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No appointments booked yet.</p>}
    </div>
  )
}

function NotificationsPage({ userId }) {
  const [userNotifications, setUserNotifications] = useState([])

  useEffect(() => {
    let active = true
    let channel

    const loadNotifications = async () => {
      if (!isSupabaseConfigured || !userId) return
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, message, created_at, is_read')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error || !active) return
      setUserNotifications(data || [])

      channel = supabase
        .channel(`customer-notifications-${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
          setUserNotifications((current) => current.some((item) => item.id === payload.new.id) ? current : [payload.new, ...current])
        })
        .subscribe()
    }

    loadNotifications()
    return () => {
      active = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [userId])

  return (
    <div className="space-y-4 pb-24">
      {userNotifications.map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={{
            title: notification.title,
            body: notification.message,
            time: new Date(notification.created_at).toLocaleString(),
            icon: 'bell',
          }}
        />
      ))}
      {userNotifications.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No new notifications.</p>}
    </div>
  )
}

function ProfilePage({ user }) {
  return (
    <div className="space-y-5 pb-24">
      <ProfileCard user={user} />
      <NotificationPreferencesCard userId={user.id} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_16px_32px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold text-slate-900">Saved details</p>
            <ShieldCheck className="text-emerald-600" size={18} />
          </div>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li className="flex items-center justify-between">
              <span>Phone number</span>
              <span className="font-semibold text-slate-800">{user.phone || 'Not provided'}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Full name</span>
              <span className="font-semibold text-slate-800">{user.fullName || 'Not provided'}</span>
            </li>
          </ul>
        </div>

      </div>
    </div>
  )
}

function NotificationPreferencesCard({ userId }) {
  const [preferences, setPreferences] = useState({ browser_enabled: true, android_enabled: true, queue_enabled: true, turn_alerts_enabled: true })
  const [devices, setDevices] = useState([])
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return undefined
    let active = true
    Promise.all([
      supabase.from('notification_preferences').select('browser_enabled, android_enabled, queue_enabled, turn_alerts_enabled').eq('user_id', userId).maybeSingle(),
      supabase.from('device_push_subscriptions').select('id, platform, permission_status, last_seen_at, revoked_at').eq('user_id', userId).order('last_seen_at', { ascending: false }),
    ]).then(([preferenceResult, deviceResult]) => {
      if (!active) return
      if (preferenceResult.data) setPreferences((current) => ({ ...current, ...preferenceResult.data }))
      if (!deviceResult.error) setDevices(deviceResult.data || [])
    })
    return () => { active = false }
  }, [userId])
  const updatePreference = async (key, value) => {
    const next = { ...preferences, [key]: value, user_id: userId, updated_at: new Date().toISOString() }
    setPreferences(next)
    const { error } = await supabase.from('notification_preferences').upsert(next)
    setMessage(error ? error.message : 'Notification preferences saved.')
  }
  const revokeDevice = async (deviceId) => {
    const { error } = await supabase.from('device_push_subscriptions').update({ revoked_at: new Date().toISOString() }).eq('id', deviceId).eq('user_id', userId)
    if (error) setMessage(error.message)
    else {
      setDevices((current) => current.map((device) => device.id === deviceId ? { ...device, revoked_at: new Date().toISOString() } : device))
      setMessage('Device revoked.')
    }
  }
  return <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between"><div><p className="text-lg font-bold text-slate-900">Notification settings</p><p className="text-sm text-slate-500">Control queue alerts and registered devices.</p></div><Bell size={18} className="text-violet-600" /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">{[['browser_enabled', 'Browser notifications'], ['android_enabled', 'Android notifications'], ['queue_enabled', 'Queue updates'], ['turn_alerts_enabled', 'Turn approaching alerts']].map(([key, label]) => <label key={key} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-sm font-semibold"><span>{label}</span><input type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => updatePreference(key, event.target.checked)} className="h-4 w-4 accent-violet-600" /></label>)}</div>
    <div className="mt-5 space-y-2">{devices.map((device) => <div key={device.id} className="flex items-center justify-between rounded-2xl border border-slate-100 p-3 text-sm"><span>{device.platform} • {device.permission_status} {device.revoked_at ? '• Revoked' : ''}</span>{!device.revoked_at && <button type="button" onClick={() => revokeDevice(device.id)} className="text-xs font-semibold text-rose-600">Revoke</button>}</div>)}</div>
    {message && <p className="mt-3 text-xs text-slate-500">{message}</p>}
  </section>
}

function LiveQueueRoute({ userId }) {
  const { bookingId } = useParams()
  return <LiveQueueTracker bookingId={bookingId} userId={userId} />
}

function SalonDetailPage() {
  const { salonId } = useParams()
  const salon = salons.find((entry) => entry.id === salonId) || salons[0]
  const salonServices = serviceCatalog.filter((service) => salon.serviceIds.includes(service.id))

  return (
    <div className="space-y-5 pb-24">
      <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_30px_rgba(15,23,42,0.05)]">
        <img src={salon.image} alt={salon.name} className="h-64 w-full object-cover" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-2xl font-black tracking-[-0.08em] text-slate-900">{salon.name}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                <MapPin size={14} />
                {salon.location}, {salon.city}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
              <Star size={12} fill="currentColor" />
              {salon.rating}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Hours</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{salon.workingHours}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Queue</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{salon.queue} in line</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_30px_rgba(15,23,42,0.04)]">
        <h3 className="text-xl font-black tracking-[-0.06em] text-slate-900">Available services</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {salonServices.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AdminLogin({ onLogin }) {
  const [phoneDigits, setPhoneDigits] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')

    try {
      validateIndianPhone(phoneDigits)
      if (!password || password.length < 6) {
        throw new Error('Password must be at least 6 characters long.')
      }

      setSubmitting(true)
      await onLogin({ phone: formatIndianPhone(phoneDigits), password })
      navigate('/admin/dashboard', { replace: true })
    } catch (error) {
      setMessage(getErrorMessage(error, 'Unable to complete login. Please check your details and try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-start justify-center overflow-y-auto bg-[radial-gradient(circle_at_top,#f5f3ff_0%,#eef2ff_30%,#f8fafc_100%)] p-3 sm:items-center sm:p-5">
      <div className="my-2 w-full max-w-md rounded-[32px] border border-slate-200 bg-white/90 p-4 shadow-[0_30px_80px_rgba(99,102,241,0.15)] backdrop-blur-sm sm:my-0 sm:p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-500 to-fuchsia-500 text-white shadow-[0_18px_40px_rgba(124,58,237,0.35)]">
            <Scissors size={28} />
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-violet-600">Premium salon booking</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.09em] text-slate-900 sm:text-4xl">BOOKSALOON</h1>
          {location.state?.reason && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">{location.state.reason}</p>}
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Mobile number</label>
            <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 focus-within:border-violet-400">
              <span className="flex items-center border-r border-slate-200 px-4 text-sm font-semibold text-slate-600">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phoneDigits}
                maxLength={10}
                onChange={(event) => setPhoneDigits(event.target.value.replace(/\D/g, '').slice(0, 10))}
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
                placeholder="98765 43210"
                aria-label="10-digit mobile number"
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Password</label>
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 pr-3 focus-within:border-violet-400">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
                placeholder="Enter your password"
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-slate-500" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          {message && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{message}</p>}
          <PrimaryButton type="submit" className="w-full py-3.5" disabled={submitting}>
            {submitting ? 'Please wait...' : 'Login to BOOKSALOON'}
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}

function AdminControls({ section, selectedSalonId, onSalonCreated }) {
  const [form, setForm] = useState({})
  const [serviceFormOpen, setServiceFormOpen] = useState(false)
  const [message, setMessage] = useState('')
  const queryClient = useQueryClient()
  const tableBySection = {
    'Services & Pricing': 'services',
    'Staff Management': 'employees',
    'Business Hours': 'salon_hours',
    'Waiting Time Settings': 'services',
    Appointments: 'bookings',
    Notifications: 'notifications',
  }
  const table = tableBySection[section]
  const query = useQuery({
    queryKey: ['admin-control', section, selectedSalonId],
    enabled: Boolean(selectedSalonId && table),
    queryFn: async () => {
      let request = supabase.from(table).select('*')
      if (table === 'notifications') {
        request = request.eq('salon_id', selectedSalonId).order('created_at', { ascending: false })
      } else if (table === 'salon_settings') {
        request = request.eq('salon_id', selectedSalonId).order('setting_key')
      } else if (table === 'salon_hours') {
        request = request.eq('salon_id', selectedSalonId).order('day_of_week')
      } else {
        request = request.eq('salon_id', selectedSalonId).order('created_at', { ascending: false })
      }
      const { data, error } = await request
      if (error) throw new Error(error.message)
      return data || []
    },
  })
  const salonStatusQuery = useQuery({
    queryKey: ['admin-salon-status', selectedSalonId],
    enabled: Boolean(selectedSalonId && section === 'Business Hours'),
    queryFn: async () => {
      const { data, error } = await supabase.from('salons').select('status').eq('id', selectedSalonId).single()
      if (error) throw new Error(error.message)
      return data
    },
  })

  useEffect(() => {
    if (!selectedSalonId || !table) return undefined
    const channel = supabase
      .channel(`admin-${table}-${selectedSalonId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `salon_id=eq.${selectedSalonId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient, section, selectedSalonId, table])

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const save = async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      let payload
      if (section === 'Services & Pricing') {
        if (!form.name?.trim() || Number(form.price) < 0 || Number(form.duration_minutes) <= 0) {
          throw new Error('Enter a service name, valid price, and duration.')
        }
        payload = {
          salon_id: selectedSalonId,
          name: form.name.trim(),
          description: form.description?.trim() || null,
          price_paise: Math.round(Number(form.price) * 100),
          duration_minutes: Number(form.duration_minutes),
          is_active: form.is_active !== false,
        }
      } else if (section === 'Staff Management') {
        if (!form.employee_name?.trim() || !/^[6-9]\d{9}$/.test(form.phone || '')) throw new Error('Enter a valid staff name and 10-digit mobile number.')
        payload = { salon_id: selectedSalonId, employee_name: form.employee_name.trim(), phone: `+91${form.phone}`, status: form.status || 'ACTIVE' }
      } else if (section === 'Business Hours') {
        payload = {
          salon_id: selectedSalonId,
          day_of_week: Number(form.day_of_week || 1),
          opening_time: form.is_closed ? null : form.opening_time,
          closing_time: form.is_closed ? null : form.closing_time,
          is_closed: Boolean(form.is_closed),
        }
      } else if (section === 'Waiting Time Settings') {
        if (Number(form.buffer_minutes) < 0) throw new Error('Waiting time cannot be negative.')
        payload = { buffer_minutes: Number(form.buffer_minutes || 0) }
      } else {
        throw new Error('Choose a supported admin setting.')
      }

      const existingId = form.id
      const request = section === 'Business Hours'
        ? supabase.from(table).upsert(payload, { onConflict: 'salon_id,day_of_week' })
        : existingId
        ? supabase.from(table).update(payload).eq('id', existingId).eq('salon_id', selectedSalonId)
        : supabase.from(table).insert(payload)
      const { error } = await request
      if (error) throw new Error(error.message)
      setForm({})
      if (section === 'Services & Pricing') setServiceFormOpen(false)
      setMessage('Saved successfully.')
      queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] })
    } catch (error) {
      setMessage(error.message)
    }
  }

  const updateStatus = async (row, status) => {
    if (section === 'Appointments' && status === 'CANCELLED') {
      const { error } = await supabase.rpc('admin_cancel_booking', { p_booking_id: row.id })
      if (error) setMessage(error.message)
      else queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] })
      return
    }
    const { error } = await supabase.from(table).update({ status }).eq('id', row.id).eq('salon_id', selectedSalonId)
    if (error) setMessage(error.message)
    else queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] })
  }

  const edit = (row) => {
    if (section === 'Services & Pricing') {
      setForm({ ...row, price: row.price_paise / 100, buffer_minutes: row.buffer_minutes || 0 })
      setServiceFormOpen(true)
    }
    else if (section === 'Waiting Time Settings') setForm({ id: row.id, buffer_minutes: row.buffer_minutes || 0, name: row.name })
    else setForm(row)
  }

  const toggleService = async (row) => {
    const { error } = await supabase
      .from('services')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
      .eq('salon_id', selectedSalonId)
    if (error) setMessage(error.message)
    else {
      setMessage(row.is_active ? 'Service closed.' : 'Service reopened.')
      queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] })
    }
  }

  const saveBusinessHours = async (event) => {
    event.preventDefault()
    setMessage('')
    const hours = form.businessHours || {}
    const payload = Object.entries(hours).map(([day, values]) => ({
      salon_id: selectedSalonId,
      day_of_week: Number(day),
      opening_time: values.is_closed ? null : values.opening_time || null,
      closing_time: values.is_closed ? null : values.closing_time || null,
      is_closed: Boolean(values.is_closed),
    }))
    const invalidDay = payload.find((day) => !day.is_closed && (!day.opening_time || !day.closing_time || day.closing_time <= day.opening_time))
    if (invalidDay) {
      setMessage('Enter valid opening and closing times for every active day.')
      return
    }
    const { error } = await supabase.from('salon_hours').upsert(payload, { onConflict: 'salon_id,day_of_week' })
    if (error) setMessage(error.message)
    else {
      setMessage('Business hours saved.')
      queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] })
    }
  }

  const toggleEmergencyClosure = async () => {
    const isPaused = salonStatusQuery.data?.status === 'PAUSED'
    const { error } = await supabase.from('salons').update({ status: isPaused ? 'ACTIVE' : 'PAUSED' }).eq('id', selectedSalonId)
    if (error) setMessage(error.message)
    else {
      setMessage(isPaused ? 'Salon reopened.' : 'Salon closed for emergency.')
      salonStatusQuery.refetch()
    }
  }

  const renderForm = () => {
    if (section === 'Services & Pricing') {
      return <div className="grid gap-3 md:grid-cols-2">
        <input value={form.name || ''} onChange={(event) => updateForm('name', event.target.value)} placeholder="Service name" className="rounded-xl border p-3 text-sm" />
        <input type="number" min="0" step="0.01" value={form.price || ''} onChange={(event) => updateForm('price', event.target.value)} placeholder="Price (₹)" className="rounded-xl border p-3 text-sm" />
        <input type="number" min="1" value={form.duration_minutes || ''} onChange={(event) => updateForm('duration_minutes', event.target.value)} placeholder="Duration (minutes)" className="rounded-xl border p-3 text-sm" />
        <input value={form.description || ''} onChange={(event) => updateForm('description', event.target.value)} placeholder="Description" className="rounded-xl border p-3 text-sm" />
      </div>
    }
    if (section === 'Staff Management') {
      return <div className="grid gap-3 md:grid-cols-2">
        <input value={form.employee_name || ''} onChange={(event) => updateForm('employee_name', event.target.value)} placeholder="Staff full name" className="rounded-xl border p-3 text-sm" />
        <input value={form.phone || ''} maxLength={10} onChange={(event) => updateForm('phone', event.target.value.replace(/\D/g, ''))} placeholder="Mobile number" className="rounded-xl border p-3 text-sm" />
      </div>
    }
    if (section === 'Business Hours') {
      return <div className="grid gap-3 md:grid-cols-4">
        <select value={form.day_of_week || 1} onChange={(event) => updateForm('day_of_week', event.target.value)} className="rounded-xl border p-3 text-sm">{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => <option key={day} value={index}>{day}</option>)}</select>
        <input type="time" value={form.opening_time || ''} onChange={(event) => updateForm('opening_time', event.target.value)} disabled={form.is_closed} className="rounded-xl border p-3 text-sm" />
        <input type="time" value={form.closing_time || ''} onChange={(event) => updateForm('closing_time', event.target.value)} disabled={form.is_closed} className="rounded-xl border p-3 text-sm" />
        <label className="flex items-center gap-2 rounded-xl border p-3 text-sm"><input type="checkbox" checked={Boolean(form.is_closed)} onChange={(event) => updateForm('is_closed', event.target.checked)} /> Closed</label>
      </div>
    }
    if (section === 'Waiting Time Settings') {
      return <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <input value={form.name || ''} readOnly placeholder="Service name" className="rounded-xl border border-slate-200 bg-slate-100 p-3 text-sm" />
        <input type="number" min="0" value={form.buffer_minutes ?? ''} onChange={(event) => updateForm('buffer_minutes', event.target.value)} placeholder="Average waiting time (minutes)" className="rounded-xl border p-3 text-sm" />
      </div>
    }
    return null
  }

  if (!selectedSalonId) {
    const createDemoSalon = async () => {
      setMessage('')
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError || !authData.user) {
        setMessage('Your Supabase admin session is not available. Please log in again.')
        return
      }

      const { error } = await supabase.from('salons').insert({
        created_by: authData.user.id,
        name: 'BOOKSALOON Demo Salon',
        slug: 'booksaloon-demo-salon',
        description: 'The primary salon managed from the BOOKSALOON admin workspace.',
        status: 'ACTIVE',
        country_code: 'IN',
      })
      if (error) {
        setMessage(error.message)
        return
      }

      setMessage('Salon created successfully.')
      onSalonCreated()
    }

    return <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h2 className="text-xl font-black tracking-[-0.06em]">Set up your salon</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Create the primary salon for this admin workspace. Services, staff, hours, and appointments will be managed here.</p>
      <PrimaryButton type="button" onClick={createDemoSalon} className="mt-5">Create salon</PrimaryButton>
      {message && <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-600">{message}</p>}
    </section>
  }
  if (section === 'Settings') return <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Global admin settings are managed securely by the platform configuration.</p>
  if (section === 'Dashboard') return null
  if (section === 'Business Hours') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const savedHours = Object.fromEntries((query.data || []).map((row) => [row.day_of_week, row]))
    const businessHours = form.businessHours || Object.fromEntries(days.map((_, day) => {
      const saved = savedHours[day]
      return [day, {
        opening_time: saved?.opening_time || '09:00',
        closing_time: saved?.closing_time || '18:00',
        is_closed: saved?.is_closed ?? true,
      }]
    }))
    return <section className="space-y-5">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-700">Business hours</p>
            <p className="mt-1 text-xs text-slate-500">Select active days and set opening and closing times.</p>
          </div>
          <button type="button" onClick={toggleEmergencyClosure} className={`rounded-full px-4 py-2 text-sm font-semibold ${salonStatusQuery.data?.status === 'PAUSED' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
            {salonStatusQuery.data?.status === 'PAUSED' ? 'Reopen salon' : 'Close salon'}
          </button>
        </div>
      </div>
      <form onSubmit={saveBusinessHours} className="space-y-3">
        {days.map((day, dayIndex) => {
          const values = businessHours[dayIndex]
          return <div key={day} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[1.2fr_1fr_1fr] sm:items-center">
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={!values.is_closed}
                onChange={(event) => setForm((current) => ({ ...current, businessHours: { ...(current.businessHours || businessHours), [dayIndex]: { ...values, is_closed: !event.target.checked } } }))}
                className="h-5 w-5 accent-violet-600"
              />
              {day}
              <span className="text-xs font-normal text-slate-400">{values.is_closed ? 'Closed' : 'Active'}</span>
            </label>
            <input type="time" value={values.opening_time} disabled={values.is_closed} onChange={(event) => setForm((current) => ({ ...current, businessHours: { ...(current.businessHours || businessHours), [dayIndex]: { ...values, opening_time: event.target.value } } }))} className="rounded-xl border border-slate-200 p-3 text-sm disabled:bg-slate-100" aria-label={`${day} opening time`} />
            <input type="time" value={values.closing_time} disabled={values.is_closed} onChange={(event) => setForm((current) => ({ ...current, businessHours: { ...(current.businessHours || businessHours), [dayIndex]: { ...values, closing_time: event.target.value } } }))} className="rounded-xl border border-slate-200 p-3 text-sm disabled:bg-slate-100" aria-label={`${day} closing time`} />
          </div>
        })}
        <div className="flex justify-end"><PrimaryButton type="submit">Save business hours</PrimaryButton></div>
      </form>
      {message && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    </section>
  }

  return <section className="space-y-5">
    <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-slate-700">Managing the connected salon</p>
        {section === 'Services & Pricing' && <p className="mt-1 text-xs text-slate-500">Live services and prices shown to customers.</p>}
      </div>
      {section === 'Services & Pricing' ? (
        <button
          type="button"
          onClick={() => {
            setForm({})
            setServiceFormOpen((open) => !open)
          }}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          {serviceFormOpen ? 'Cancel' : 'Add new service'}
        </button>
      ) : !['Appointments', 'Notifications'].includes(section) ? (
        <form onSubmit={save} className="flex flex-1 flex-col gap-3 sm:flex-row sm:justify-end">{renderForm()}<PrimaryButton type="submit">{form.id ? 'Update' : 'Save'}</PrimaryButton></form>
      ) : null}
    </div>
    {section === 'Services & Pricing' && serviceFormOpen && (
      <form onSubmit={save} className="rounded-[28px] border border-violet-100 bg-violet-50/50 p-5">
        <div className="grid gap-3 md:grid-cols-2">{renderForm()}</div>
        <div className="mt-3 flex justify-end"><PrimaryButton type="submit">{form.id ? 'Save changes' : 'Add service'}</PrimaryButton></div>
      </form>
    )}
    {message && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
    {query.isLoading && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Loading...</p>}
    {query.isError && <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-600">{query.error.message}</p>}
    {!query.isLoading && !query.isError && query.data?.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No records found.</p>}
    <div className="grid gap-3">
      {query.data?.map((row) => (
        <div key={row.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{row.name || row.employee_name || row.setting_key || row.booking_number || row.title || 'Record'}</p>
            <p className="text-sm text-slate-500">
              {section === 'Services & Pricing' && `₹${(row.price_paise / 100).toLocaleString('en-IN')} • ${row.duration_minutes} min • ${row.buffer_minutes || 0} min waiting`}
              {section === 'Staff Management' && `${row.phone || 'No phone'} • ${row.status}`}
              {section === 'Business Hours' && `${row.opening_time || '--'} - ${row.closing_time || '--'} • ${row.is_closed ? 'Closed' : 'Open'}`}
              {section === 'Waiting Time Settings' && `${row.buffer_minutes || 0} minutes average waiting time`}
              {section === 'Appointments' && `${row.status} • ${new Date(row.scheduled_start).toLocaleString()}`}
              {section === 'Notifications' && row.message}
            </p>
          </div>
          <div className="flex gap-2">
            {section === 'Services & Pricing' && <button type="button" onClick={() => edit(row)} className="rounded-full border px-3 py-2 text-xs font-semibold">Change pricing</button>}
            {['Staff Management', 'Business Hours', 'Waiting Time Settings'].includes(section) && <button type="button" onClick={() => edit(row)} className="rounded-full border px-3 py-2 text-xs font-semibold">{section === 'Waiting Time Settings' ? 'Set waiting time' : 'Edit'}</button>}
            {section === 'Services & Pricing' && <button type="button" onClick={() => toggleService(row)} className={`rounded-full px-3 py-2 text-xs font-semibold ${row.is_active ? 'border border-rose-200 text-rose-700' : 'border border-emerald-200 text-emerald-700'}`}>{row.is_active ? 'Close service' : 'Open service'}</button>}
            {((section === 'Staff Management' || section === 'Appointments') && <select value={row.status} onChange={(event) => updateStatus(row, event.target.value)} className="rounded-full border px-3 py-2 text-xs"><option value="PENDING">Pending</option><option value="WAITING">Waiting</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ON_LEAVE">On leave</option><option value="CONFIRMED">Confirmed</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option><option value="NO_SHOW">No show</option></select>)}
            {section === 'Notifications' && !row.is_read && <button type="button" onClick={async () => { const { error } = await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', row.id); if (error) setMessage(error.message); else queryClient.invalidateQueries({ queryKey: ['admin-control', section, selectedSalonId] }) }} className="rounded-full border px-3 py-2 text-xs font-semibold">Mark read</button>}
          </div>
        </div>
      ))}
    </div>
  </section>
}

function SalonFloor({ salonId }) {
  const queryClient = useQueryClient()
  const [walkInOpen, setWalkInOpen] = useState(false)
  const [assignmentChoice, setAssignmentChoice] = useState({})
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const floorQuery = useQuery({
    queryKey: ['salon-floor', salonId],
    enabled: Boolean(salonId && isSupabaseConfigured),
    refetchInterval: 10000,
    queryFn: async () => {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const [employees, statuses, services, assignments, queues] = await Promise.all([
        supabase.from('employees').select('id, employee_name, status').eq('salon_id', salonId).order('employee_name'),
        supabase.from('employee_floor_status').select('employee_id, status').eq('salon_id', salonId),
        supabase.from('services').select('id, name, duration_minutes, is_active').eq('salon_id', salonId).eq('is_active', true).order('name'),
        supabase.from('booking_staff').select('employee_id, booking_id, start_at, end_at, booking:bookings(id, status, customer_name_snapshot, customer_phone_snapshot, customer:profiles(full_name, phone), booking_items(service_name_snapshot))').eq('salon_id', salonId).eq('status', 'ACTIVE').gt('end_at', new Date().toISOString()),
        supabase.from('queue_entries').select('id, booking_id, queue_number, status, estimated_wait_minutes, estimated_start_at, customer_name_snapshot, customer_phone_snapshot, customer:profiles(full_name, phone), booking:bookings(booking_type, status, scheduled_start, booking_items(service_name_snapshot), booking_staff(employee:employees(employee_name)) )').eq('salon_id', salonId).eq('queue_date', today).in('status', ['WAITING', 'CALLED', 'SERVING']).order('queue_number'),
      ])
      const failed = [employees, statuses, services, assignments, queues].find((result) => result.error)
      if (failed) throw new Error(failed.error.message)
      const statusMap = Object.fromEntries((statuses.data || []).map((status) => [status.employee_id, status.status]))
      const assignmentMap = Object.fromEntries((assignments.data || []).map((assignment) => [assignment.employee_id, assignment]))
      return {
        employees: (employees.data || []).map((employee) => ({ ...employee, floorStatus: statusMap[employee.id] || 'AVAILABLE', assignment: assignmentMap[employee.id] })),
        services: services.data || [],
        queue: queues.data || [],
      }
    },
  })

  useEffect(() => {
    if (!salonId) return undefined
    const channel = supabase.channel(`salon-floor-${salonId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `salon_id=eq.${salonId}` }, () => queryClient.invalidateQueries({ queryKey: ['salon-floor', salonId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_staff', filter: `salon_id=eq.${salonId}` }, () => queryClient.invalidateQueries({ queryKey: ['salon-floor', salonId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'queue_entries', filter: `salon_id=eq.${salonId}` }, () => queryClient.invalidateQueries({ queryKey: ['salon-floor', salonId] }))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient, salonId])

  const data = floorQuery.data || { employees: [], services: [], queue: [] }
  const busyBarbers = data.employees.filter((employee) => employee.assignment)
  const availableBarbers = data.employees.filter((employee) => !employee.assignment && employee.floorStatus === 'AVAILABLE')
  const breakBarbers = data.employees.filter((employee) => !employee.assignment && employee.floorStatus === 'BREAK')
  const offlineBarbers = data.employees.filter((employee) => !employee.assignment && employee.floorStatus === 'OFFLINE')
  const waiting = data.queue.filter((entry) => entry.status === 'WAITING' || entry.status === 'CALLED')
  const estimatedWait = waiting.reduce((max, entry) => Math.max(max, entry.estimated_wait_minutes || 0), 0)
  const runAction = async (label, rpc, args) => {
    setBusyAction(label)
    setActionError('')
    setActionMessage('')
    const { error } = await supabase.rpc(rpc, { p_salon_id: salonId, ...args })
    setBusyAction('')
    if (error) setActionError(error.message)
    else {
      setActionMessage(label)
      floorQuery.refetch()
    }
  }
  const customerName = (entry) => entry.customer_name_snapshot || entry.customer?.full_name || 'Walk-in customer'
  const serviceName = (entry) => entry.booking?.booking_items?.map((item) => item.service_name_snapshot).join(', ') || 'Service'

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-[28px] bg-[#0b1220] p-5 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d9b78c]">Live operations</p><h2 className="mt-1 text-2xl font-black">Salon Floor</h2><p className="mt-1 text-sm text-slate-300">All times and ETAs are live estimates from Supabase.</p></div>
        <button type="button" onClick={() => setWalkInOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#d9b78c] px-5 py-3 text-sm font-black text-[#0b1220]"><Plus size={18} /> ADD WALK-IN CUSTOMER</button>
      </div>
      {actionError && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{actionError}</p>}
      {actionMessage && <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-700">{actionMessage}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Available', availableBarbers.length, 'text-emerald-600'],
          ['Busy', busyBarbers.length, 'text-violet-600'],
          ['On break', breakBarbers.length, 'text-amber-600'],
          ['Offline', offlineBarbers.length, 'text-slate-500'],
          ['Waiting', waiting.length, 'text-rose-600'],
        ].map(([label, value, color]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-2 text-3xl font-black ${color}`}>{value}</p>{label === 'Waiting' && <p className="text-xs text-slate-500">Max estimate: {estimatedWait} min</p>}</div>)}
      </div>
      {floorQuery.isLoading && <p className="rounded-2xl bg-white p-5 text-sm text-slate-500">Loading salon floor...</p>}
      {floorQuery.isError && <p className="rounded-2xl bg-rose-50 p-5 text-sm text-rose-700">{floorQuery.error.message}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.employees.map((employee) => {
          const assignment = employee.assignment
          const booking = assignment?.booking
          const status = assignment ? 'BUSY' : employee.floorStatus
          return <div key={employee.id} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-bold text-slate-900">{employee.employee_name}</p><p className="mt-1 text-xs text-slate-500">Barber management</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${status === 'BUSY' ? 'bg-violet-100 text-violet-700' : status === 'AVAILABLE' ? 'bg-emerald-100 text-emerald-700' : status === 'BREAK' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{status}</span>
            </div>
            {assignment ? <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm"><p className="font-semibold">{booking?.customer_name_snapshot || booking?.customer?.full_name || 'Customer'}</p><p className="text-slate-500">{booking?.booking_items?.map((item) => item.service_name_snapshot).join(', ') || 'Service'} • started {new Date(assignment.start_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p><p className="mt-1 text-xs text-slate-500">Estimated remaining: {Math.max(0, Math.ceil((new Date(assignment.end_at).getTime() - Date.now()) / 60000))} min</p></div> : <p className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">No active customer</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {assignment ? <button type="button" disabled={busyAction === 'Complete service'} onClick={() => runAction('Complete service', 'complete_service', { p_booking_id: assignment.booking_id })} className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Complete Service</button> : <>
                <button type="button" onClick={() => runAction('Available', 'update_staff_availability', { p_employee_id: employee.id, p_status: 'AVAILABLE' })} className="rounded-full border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700">Mark Available</button>
                <button type="button" onClick={() => runAction('Break', 'update_staff_availability', { p_employee_id: employee.id, p_status: 'BREAK' })} className="rounded-full border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700"><Coffee size={13} className="mr-1 inline" />Start Break</button>
                <button type="button" onClick={() => runAction('Offline', 'update_staff_availability', { p_employee_id: employee.id, p_status: 'OFFLINE' })} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Mark Offline</button>
              </>}
            </div>
          </div>
        })}
      </div>
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between"><div><h3 className="text-xl font-black">Unified waiting queue</h3><p className="text-sm text-slate-500">Online appointments and walk-ins, ordered by queue number.</p></div><button type="button" onClick={() => floorQuery.refetch()} className="rounded-full border p-2 text-slate-500" aria-label="Refresh floor"><RefreshCw size={16} /></button></div>
        <div className="space-y-2">{waiting.map((entry) => <div key={entry.id} className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-bold text-white">{entry.booking?.booking_type === 'WALK_IN' ? 'WALK_IN' : 'ONLINE'}</span><p className="font-semibold">{customerName(entry)}</p></div><p className="mt-1 text-sm text-slate-500">{serviceName(entry)} • {entry.booking?.booking_staff?.[0]?.employee?.employee_name || 'Unassigned'}</p></div><div className="text-left sm:text-right"><p className="font-bold">Queue {entry.queue_number}</p><p className="text-xs text-slate-500">Estimated wait: {entry.estimated_wait_minutes ?? 'calculating'} min</p><div className="mt-2 flex flex-wrap justify-end gap-2">{!entry.booking?.booking_staff?.length && <><select value={assignmentChoice[entry.booking_id] || ''} onChange={(event) => setAssignmentChoice((current) => ({ ...current, [entry.booking_id]: event.target.value }))} className="rounded-full border bg-white px-2 py-1 text-xs"><option value="">Assign barber</option>{availableBarbers.map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_name}</option>)}</select><button type="button" disabled={!assignmentChoice[entry.booking_id]} onClick={() => runAction('Assign customer', 'assign_waiting_customer', { p_booking_id: entry.booking_id, p_employee_id: assignmentChoice[entry.booking_id] })} className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">Assign</button></>}<button type="button" onClick={() => runAction('Cancel booking', 'cancel_walkin_booking', { p_booking_id: entry.booking_id })} className="rounded-full px-2 py-1 text-xs font-semibold text-rose-600">Cancel</button></div></div></div>)}</div>
        {waiting.length === 0 && !floorQuery.isLoading && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No customers are waiting.</p>}
      </div>
      {walkInOpen && <WalkInModal salonId={salonId} services={data.services} employees={data.employees} onClose={() => setWalkInOpen(false)} onCreated={() => { setWalkInOpen(false); floorQuery.refetch(); setActionMessage('Walk-in customer added') }} />}
    </section>
  )
}

function WalkInModal({ salonId, services, employees, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', serviceId: services[0]?.id || '', mode: 'AUTO', employeeId: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    const { error: rpcError } = await supabase.rpc('create_walkin_booking', {
      p_salon_id: salonId,
      p_customer_name: form.name,
      p_customer_phone: form.phone || null,
      p_service_id: form.serviceId,
      p_preferred_employee_id: form.mode === 'MANUAL' ? form.employeeId : null,
      p_assignment_mode: form.mode,
    })
    setSaving(false)
    if (rpcError) setError(rpcError.message)
    else onCreated()
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-2xl font-black">Add walk-in customer</h2><button type="button" onClick={onClose} className="text-slate-400">Close</button></div><div className="mt-5 grid gap-4"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Customer name *" className="rounded-2xl border px-4 py-3" /><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Mobile number (optional)" className="rounded-2xl border px-4 py-3" /><select required value={form.serviceId} onChange={(event) => setForm({ ...form, serviceId: event.target.value })} className="rounded-2xl border px-4 py-3">{services.map((service) => <option key={service.id} value={service.id}>{service.name} • {service.duration_minutes} min</option>)}</select><select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })} className="rounded-2xl border px-4 py-3"><option value="AUTO">Auto-assign next available barber</option><option value="QUEUE">Add to waiting queue</option><option value="MANUAL">Manually select a barber</option></select>{form.mode === 'MANUAL' && <select required value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} className="rounded-2xl border px-4 py-3"><option value="">Select barber</option>{employees.filter((employee) => !employee.assignment && employee.floorStatus === 'AVAILABLE').map((employee) => <option key={employee.id} value={employee.id}>{employee.employee_name}</option>)}</select>}</div>{error && <p className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}<button disabled={saving} className="mt-5 w-full rounded-full bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Adding...' : 'Add customer'}</button></form></div>
}

function AdminDashboard({ onLogout }) {
  const [checkingSession, setCheckingSession] = useState(true)
  const [activeSection, setActiveSection] = useState('Handle Offline')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedSalonId, setSelectedSalonId] = useState('')
  const navigate = useNavigate()
  const salonsQuery = useQuery({
    queryKey: ['admin-salons'],
    enabled: !checkingSession && isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await supabase.from('salons').select('id, name').order('created_at', { ascending: true }).limit(1)
      if (error) throw new Error(error.message)
      return data || []
    },
  })
  const salonsList = salonsQuery.data || []

  useEffect(() => {
    if (!selectedSalonId && salonsList[0]?.id) setSelectedSalonId(salonsList[0].id)
  }, [salonsList, selectedSalonId])
  const queueQuery = useQuery({
    queryKey: ['admin-live-queue'],
    enabled: !checkingSession && isSupabaseConfigured,
    refetchInterval: 15000,
    queryFn: async () => {
      const { error: expiryError } = await supabase.rpc('expire_overdue_queue_entries')
      if (expiryError) {
        throw new Error(expiryError.message)
      }
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('queue_entries')
        .select('id, queue_number, estimated_wait_minutes, estimated_start_at, status, customer:profiles!queue_entries_customer_id_fkey(full_name, phone), salon:salons(name), booking:bookings(booking_number, scheduled_start)')
        .eq('queue_date', today)
        .in('status', ['WAITING', 'CALLED', 'SERVING'])
        .order('queue_number', { ascending: true })

      if (error) {
        throw new Error(error.message)
      }
      return data || []
    },
  })

  useEffect(() => {
    let active = true
    validateAdminSession().then((isValid) => {
      if (!active) return
      if (!isValid) {
        navigate('/admin/login', {
          replace: true,
          state: { reason: 'Your admin session was ended because another device logged in.' },
        })
      }
      setCheckingSession(false)
    })
    return () => {
      active = false
    }
  }, [navigate])

  if (checkingSession) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">Checking admin session...</div>
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1220] px-4 py-4 text-white shadow-lg sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-lg font-black tracking-[-0.06em]">BOOKSALOON</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">Admin workspace</p>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              <Menu size={17} /> Menu
            </button>
            {menuOpen && (
              <nav
                aria-label="Admin menu"
                className="absolute right-0 mt-3 grid w-64 gap-1 rounded-2xl border border-slate-200 bg-white p-2 text-sm text-slate-700 shadow-2xl"
              >
                {['Dashboard', 'Handle Offline', 'Services & Pricing', 'Staff Management', 'Business Hours', 'Waiting Time Settings', 'Appointments', 'Notifications', 'Settings'].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setActiveSection(item)
                      setMenuOpen(false)
                    }}
                    className={`rounded-xl px-3 py-2.5 text-left transition ${activeSection === item ? 'bg-slate-900 font-semibold text-white' : 'hover:bg-slate-100'}`}
                  >
                    {item}
                  </button>
                ))}
                <button type="button" onClick={onLogout} className="mt-1 inline-flex items-center gap-2 rounded-xl border-t border-slate-200 px-3 py-3 text-left text-slate-500 hover:bg-slate-100">
                  <LogOut size={15} /> Logout
                </button>
              </nav>
            )}
          </div>
        </div>
      </header>

      <main className="min-w-0 p-5 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex flex-col gap-4 rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_20px_40px_rgba(15,23,42,0.04)] md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-violet-600">BOOKSALOON Admin</p>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.08em]">{activeSection}</h1>
          </div>
          <PrimaryButton onClick={() => navigate('/customer/home')}>Go to customer app</PrimaryButton>
        </header>

        {activeSection === 'Handle Offline' ? (
          <SalonFloor salonId={selectedSalonId} />
        ) : activeSection === 'Dashboard' ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_20px_40px_rgba(15,23,42,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black tracking-[-0.06em]">Live customers queue</h2>
                    <p className="mt-1 text-sm text-slate-500">Active customers for today, loaded from Supabase.</p>
              </div>
              <button type="button" onClick={() => queueQuery.refetch()} className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Refresh
              </button>
            </div>
            {!isSupabaseConfigured && <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">Connect Supabase to view the live queue.</p>}
            {queueQuery.isLoading && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Loading live queue...</p>}
            {queueQuery.isError && <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-600">{queueQuery.error.message}</p>}
            {!queueQuery.isLoading && !queueQuery.isError && isSupabaseConfigured && queueQuery.data?.length === 0 && (
              <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No customers are currently waiting.</p>
            )}
            <div className="space-y-3">
              {queueQuery.data?.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-[22px] bg-slate-50 p-4">
                  <div>
                    <p className="font-semibold text-slate-900">{entry.customer?.full_name || 'Customer'}</p>
                    <p className="text-sm text-slate-500">{entry.customer?.phone || 'No phone number'} • {entry.salon?.name || 'Salon'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">Queue {entry.queue_number}</p>
                    <p className="text-xs capitalize text-slate-500">{entry.status.toLowerCase()} {entry.estimated_wait_minutes == null ? '' : `• ${entry.estimated_wait_minutes} min wait`}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <AdminControls
            section={activeSection}
            selectedSalonId={selectedSalonId}
            onSalonCreated={() => salonsQuery.refetch()}
          />
        )}
        </div>
      </main>
    </div>
  )
}

function AuthPage({ initialMode, onLogin, onRegister }) {
  const [mode, setMode] = useState(initialMode)
  const [fullName, setFullName] = useState('')
  const [phoneDigits, setPhoneDigits] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const returnPath = location.state?.from || '/customer/home'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')

    try {
      if (mode === 'register') {
        if (!fullName.trim()) {
          throw new Error('Please enter your full name.')
        }
        if (!acceptedTerms) {
          throw new Error('Please accept the terms to continue.')
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.')
        }

        const result = await onRegister({ fullName: fullName.trim(), phone: formatIndianPhone(phoneDigits), password })
        if (result?.success) {
          navigate(returnPath, { replace: true })
          return
        }
      } else {
        const result = await onLogin({ phone: formatIndianPhone(phoneDigits), password })
        if (result?.success) {
          navigate(returnPath, { replace: true })
          return
        }
      }

      setMessage('Authentication failed. Please try again.')
    } catch (error) {
      setMessage(getErrorMessage(error, 'Unable to complete authentication. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f5f3ff_0%,#eef2ff_30%,#f8fafc_100%)] p-5">
      <div className="w-full max-w-md rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-[0_30px_80px_rgba(99,102,241,0.15)] backdrop-blur-sm">
        <div className="mb-6 text-center">
          <Link
            to="/"
            aria-label="Go to the BOOKSALOON landing page"
            className="mx-auto block w-fit rounded-3xl"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-500 to-fuchsia-500 text-white shadow-[0_18px_40px_rgba(124,58,237,0.35)] sm:h-16 sm:w-16">
              <Scissors size={26} />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-violet-600">Premium salon booking</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.09em] text-slate-900">BOOKSALOON</h1>
          </Link>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-full bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`min-w-0 rounded-full px-3 py-2.5 text-sm font-semibold transition ${mode === 'login' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`min-w-0 rounded-full px-3 py-2.5 text-sm font-semibold transition ${mode === 'register' ? 'bg-white text-slate-900 shadow' : 'text-slate-500'}`}
          >
            Register
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:bg-white"
                placeholder="John Doe"
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Mobile number</label>
            <div className="flex overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 transition focus-within:border-violet-400 focus-within:bg-white">
              <span className="flex items-center border-r border-slate-200 px-4 text-sm font-semibold text-slate-600">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phoneDigits}
                maxLength={10}
                onChange={(event) => setPhoneDigits(event.target.value.replace(/\D/g, '').slice(0, 10))}
                className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm outline-none"
                placeholder="98765 43210"
                aria-label="10-digit mobile number"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:bg-white"
              placeholder="Enter your password"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-violet-400 focus:bg-white"
                placeholder="Repeat password"
              />
            </div>
          )}

          {mode === 'register' && (
            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-1 h-4 w-4 accent-violet-600"
              />
              <span>I accept the terms and conditions and understand that this app uses password authentication with my Indian mobile number.</span>
            </label>
          )}

          {message && <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{message}</p>}

          <PrimaryButton type="submit" className="w-full py-3.5" disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'login' ? 'Login to BOOKSALOON' : 'Create account'}
          </PrimaryButton>
        </form>

        {mode === 'login' && (
          <div className="mt-5 text-center text-sm text-slate-500">
            Forgot password? <button type="button" className="font-semibold text-violet-700">Reset securely</button>
          </div>
        )}

      </div>
    </div>
  )
}

function CustomerApp({ user, onLogout }) {
  const [userBookings, setUserBookings] = useState([])
  const [profile, setProfile] = useState(user)

  useEffect(() => {
    let active = true
    const loadProfile = async () => {
      if (!isSupabaseConfigured) return
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (authError || !authData.user) {
          if (authError) console.error('Unable to restore customer session:', authError)
          return
        }
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('full_name, phone, created_at')
          .eq('id', authData.user.id)
          .maybeSingle()
        const { data: bookingData, error: bookingError } = await supabase
          .from('bookings')
          .select('id, booking_number, status, scheduled_start, total_paise, salon:salons(name), booking_items(service_name_snapshot), booking_staff(employee:employees(employee_name))')
          .eq('customer_id', authData.user.id)
          .order('created_at', { ascending: false })
        if (profileError) console.error('Unable to load customer profile:', profileError)
        if (bookingError) console.error('Unable to load customer bookings:', bookingError)
        if (active && profileData) {
          setProfile((current) => ({
            ...current,
            fullName: profileData.full_name || current.fullName,
            phone: profileData.phone || current.phone,
            memberSince: profileData.created_at
              ? new Date(profileData.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
              : current.memberSince,
          }))
        }
        if (active && Array.isArray(bookingData)) {
          setUserBookings(bookingData.map((booking) => ({
            id: booking.booking_number || booking.id,
            bookingId: booking.id,
            service: Array.isArray(booking.booking_items)
              ? booking.booking_items.map((item) => item.service_name_snapshot).join(', ') || 'Salon appointment'
              : 'Salon appointment',
            salon: booking.salon?.name || 'BOOKSALOON',
            amount: `₹${((booking.total_paise || 0) / 100).toLocaleString('en-IN')}`,
            barber: booking.booking_staff?.[0]?.employee?.employee_name || 'To be assigned',
            date: booking.scheduled_start ? new Date(booking.scheduled_start).toLocaleDateString('en-IN') : 'Date to be confirmed',
            status: booking.status === 'CONFIRMED' ? 'Confirmed' : booking.status === 'WAITING' ? 'Waiting' : booking.status,
          })))
        }
      } catch (loadError) {
        console.error('Unable to load customer data:', loadError)
      }
    }
    loadProfile()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    initializeAndroidNotifications().catch((error) => {
      console.error('Unable to enable Android notifications:', error)
    })
  }, [])

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <AppHeader title="BOOKSALOON" subtitle="Premium salon booking" userName={profile.fullName} onLogout={onLogout} />
      <main className="mx-auto max-w-6xl px-4 py-5 pb-28 sm:px-6 lg:px-8 md:pb-5">
        <Routes>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<HomePage userName={profile.fullName || 'Customer'} userId={profile.id} userBookings={userBookings} onBookingCreated={(booking) => setUserBookings((current) => [booking, ...current])} />} />
          <Route path="bookings" element={<BookingsPage userBookings={userBookings} />} />
          <Route path="queue/:bookingId" element={<LiveQueueRoute userId={profile.id} />} />
          <Route path="notifications" element={<NotificationsPage userId={profile.id} />} />
          <Route path="profile" element={<ProfilePage user={profile} />} />
          <Route path="salon/:salonId" element={<SalonDetailPage />} />
        </Routes>
      </main>
      <BottomNavigation />
    </div>
  )
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState({ ...customerProfile, fullName: 'Aarav Sharma' })
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    requestAndroidNotificationPermission().catch((error) => {
      console.error('Unable to request Android notification permission:', error)
    })
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false)
      return undefined
    }

    let active = true
    const restoreCustomerSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) {
          await supabase.auth.signOut()
          return
        }
        const user = data.session?.user
        if (active && user?.email?.startsWith('phone-')) {
          setCurrentUser((previous) => ({
            ...previous,
            id: user.id,
            phone: user.user_metadata?.phone || previous.phone,
            fullName: user.user_metadata?.full_name || previous.fullName || 'Customer',
          }))
          setIsAuthenticated(true)
        }
      } catch (restoreError) {
        console.error('Unable to restore saved session:', restoreError)
        await supabase.auth.signOut()
      } finally {
        setAuthLoading(false)
      }
    }

    restoreCustomerSession()
    return () => {
      active = false
    }
  }, [])

  const onLogin = async ({ phone, password }) => {
    const normalizedPhone = phone?.replace(/^\+91/, '') || ''
    validateIndianPhone(normalizedPhone)

    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.')
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: getAuthEmail(phone),
        password,
      })
      if (error) {
        throw new Error(getErrorMessage(error, 'Unable to sign in. Please check your phone number and password.'))
      }
      if (!data?.user?.id) {
        throw new Error('Login did not return a valid user session. Please try again.')
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('id', data.user.id)
        .maybeSingle()
      setCurrentUser((previous) => ({
        ...previous,
        id: data.user.id,
        phone: profile?.phone || phone,
        fullName: profile?.full_name || data.user.user_metadata?.full_name || 'Customer',
      }))
    } else {
      setCurrentUser((previous) => ({ ...previous, phone, fullName: previous.fullName || 'Customer' }))
    }
    setIsAuthenticated(true)
    return { success: true }
  }

  const onRegister = async ({ fullName, phone, password }) => {
    validateIndianPhone(phone.replace(/^\+91/, ''))

    if (!fullName || !phone || !password) {
      throw new Error('Name, phone and password are required.')
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.')
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.signUp({
        email: getAuthEmail(phone),
        password,
        options: {
          data: { full_name: fullName, phone },
        },
      })
      if (error) {
        throw new Error(error.message)
      }
      setCurrentUser((previous) => ({ ...previous, id: data.user?.id, fullName, phone }))
    } else {
      setCurrentUser((previous) => ({ ...previous, fullName, phone }))
    }
    setIsAuthenticated(true)
    return { success: true }
  }

  const onLogout = () => {
    setIsAuthenticated(false)
    if (isSupabaseConfigured) {
      supabase.auth.signOut().catch((error) => {
        console.error('Unable to sign out:', error)
      })
    }
  }

  const onAdminLogin = async ({ phone, password }) => {
    if (!isSupabaseConfigured) {
      throw new Error('Admin login is unavailable until Supabase is configured.')
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: getAdminAuthEmail(phone),
      password,
    })
    if (error) {
      throw new Error('Invalid admin credentials.')
    }

    try {
      await issueAdminSession()
      setIsAdminAuthenticated(true)
    } catch (sessionError) {
      await supabase.auth.signOut()
      throw new Error(sessionError.message === 'ADMIN_ACCESS_REQUIRED' ? 'This account is not authorized for admin access.' : sessionError.message)
    }
  }

  const onAdminLogout = async () => {
    await revokeAdminSession()
    await supabase.auth.signOut()
    setIsAdminAuthenticated(false)
  }

  return (
    <AppErrorBoundary>
      <BrowserRouter>
      {authLoading ? <LoadingScreen /> : (
      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to="/customer/home" replace /> : <FrontendLandingPage />} />
        <Route path="/login" element={<AuthPage initialMode="login" onLogin={onLogin} onRegister={onRegister} />} />
        <Route path="/register" element={<AuthPage initialMode="register" onLogin={onLogin} onRegister={onRegister} />} />
        <Route path="/customer/*" element={isAuthenticated ? <CustomerApp user={currentUser} onLogout={onLogout} /> : <Navigate to="/login" replace />} />
        <Route path="/admin" element={<Navigate to={isAdminAuthenticated ? '/admin/dashboard' : '/admin/login'} replace />} />
        <Route path="/admin/login" element={<AdminLogin onLogin={onAdminLogin} />} />
        <Route path="/admin/dashboard" element={isAdminAuthenticated ? <AdminDashboard onLogout={onAdminLogout} /> : <Navigate to="/admin/login" replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? '/customer/home' : '/login'} replace />} />
      </Routes>
      )}
      </BrowserRouter>
    </AppErrorBoundary>
  )
}

export default App
