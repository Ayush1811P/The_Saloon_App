import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig, motion, useScroll, useSpring, useTransform } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  Menu,
  Scissors,
  Sparkles,
  Star,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import { offers, salons, serviceCatalog } from '../../../src/data/mockData'

const NAV = [
  ['Services', 'services'],
  ['Quick Turn', 'quick-turn'],
  ['How it works', 'how-it-works'],
  ['Offers', 'offers'],
]
const SERVICE_NAMES = ['Haircut & Styling', 'Beard & Grooming', 'Hair Spa', 'Facial & Skin Care']
const SERVICE_ICONS = [Scissors, UserRound, Sparkles, Star]
const EXTRA_SERVICE = {
  id: 'facial-skin-care',
  name: 'Facial & Skin Care',
  description: 'Skin-focused care for a refreshed, polished finish.',
  price: 250,
  duration: 45,
}
const EASE = [0.2, 0.8, 0.2, 1]
const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.7, delay, ease: EASE },
})

function Eyebrow({ children, light = false }) {
  return <p className={`text-xs font-bold uppercase tracking-[0.28em] ${light ? 'text-gold' : 'text-gold-deep'}`}>{children}</p>
}

function Title({ children, className = '' }) {
  return <h2 className={`font-display text-[clamp(2rem,5vw,3.6rem)] leading-[1.05] tracking-tight ${className}`}>{children}</h2>
}

function GoldButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`group inline-flex items-center justify-center gap-2 rounded-full bg-gold px-6 py-3.5 text-sm font-bold text-ink shadow-[0_12px_30px_rgba(217,183,140,0.25)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#e9d2b0] hover:shadow-[0_16px_36px_rgba(217,183,140,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${className}`}
    >
      {children}
    </button>
  )
}

function Brand({ className = '' }) {
  return (
    <Link to="/" aria-label="BOOKSALOON home" className={`flex items-center gap-3 ${className}`}>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-gold text-ink">
        <Scissors size={18} />
      </span>
      <span className="font-display text-xl tracking-tight text-white">BOOK<span className="text-gold">SALOON</span></span>
    </Link>
  )
}

function Header({ go }) {
  const [open, setOpen] = useState(false)
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition duration-300 ${solid || open ? 'bg-ink/90 shadow-lg shadow-black/20 backdrop-blur-xl' : 'bg-transparent'}`}>
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
        <Brand />
        <nav aria-label="Main" className="hidden items-center gap-8 text-sm text-slate-300 lg:flex">
          {NAV.map(([label, id]) => (
            <a key={id} href={`#${id}`} className="relative py-1 transition hover:text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-gold after:transition-transform after:duration-300 hover:after:scale-x-100">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => go('/login')} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Login</button>
          <button type="button" onClick={() => go('/register')} className="inline-flex rounded-full bg-gold px-3 py-2 text-xs font-bold text-ink transition hover:bg-[#e9d2b0] sm:px-5 sm:py-2.5 sm:text-sm">Register</button>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} className="grid h-10 w-10 place-items-center rounded-full border border-white/20 text-white lg:hidden">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav id="mobile-menu" aria-label="Mobile" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }} className="border-t border-white/10 px-5 pb-6 pt-3 lg:hidden">
            {NAV.map(([label, id], i) => (
              <motion.a key={id} href={`#${id}`} onClick={() => setOpen(false)} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex items-center justify-between border-b border-white/10 py-4 font-display text-2xl text-white">
                {label} <ArrowRight size={18} className="text-gold" />
              </motion.a>
            ))}
            <GoldButton onClick={() => { setOpen(false); go('/register') }} className="mt-6 w-full">Book your appointment</GoldButton>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}

function SpinBadge() {
  return (
    <div aria-hidden="true" className="absolute right-6 top-28 hidden h-36 w-36 place-items-center md:grid lg:right-12 lg:top-[28%] lg:h-44 lg:w-44">
      <motion.svg viewBox="0 0 200 200" animate={{ rotate: 360 }} transition={{ duration: 28, repeat: Infinity, ease: 'linear' }} className="absolute inset-0 h-full w-full">
        <defs><path id="badge-circle" d="M100,100 m-80,0 a80,80 0 1,1 160,0 a80,80 0 1,1 -160,0" /></defs>
        <text className="fill-gold font-bold" style={{ fontSize: 12 }}>
          <textPath href="#badge-circle" textLength="496" lengthAdjust="spacing">BOOK • STYLE • TURN • BOOK • STYLE • TURN •</textPath>
        </text>
      </motion.svg>
      <motion.span animate={{ rotate: [0, -12, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} className="grid h-16 w-16 place-items-center rounded-full bg-gold text-ink shadow-xl shadow-black/30">
        <Scissors size={26} />
      </motion.span>
    </div>
  )
}

function BookingBar({ services, go }) {
  const [serviceId, setServiceId] = useState(services[0]?.id)
  const [when, setWhen] = useState('now')
  const picked = services.find((s) => s.id === serviceId) || services[0]
  const whens = [['now', 'Quick Turn'], ['today', 'Today'], ['tomorrow', 'Tomorrow']]

  return (
    <motion.form
      onSubmit={(e) => { e.preventDefault(); go('/register', { service: serviceId, when }) }}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.2, duration: 0.8, ease: EASE }}
      className="grid gap-4 rounded-[2rem] border border-white/15 bg-white/10 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-5 lg:grid-cols-[1.2fr_1.4fr_auto] lg:items-end"
    >
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Service</span>
        <span className="relative block">
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full appearance-none rounded-2xl border border-white/15 bg-ink/60 py-3.5 pl-4 pr-10 text-sm text-white outline-none transition focus:border-gold">
            {services.map((s, i) => <option key={s.id} value={s.id} className="text-ink">{SERVICE_NAMES[i] || s.name} · ₹{s.price}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gold" />
        </span>
      </label>

      <fieldset>
        <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">When</legend>
        <div role="radiogroup" aria-label="When" className="grid grid-cols-3 gap-1 rounded-2xl bg-ink/60 p-1">
          {whens.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={when === key} onClick={() => setWhen(key)} className={`relative rounded-xl px-2 py-2.5 text-xs font-semibold transition-colors sm:text-sm ${when === key ? 'text-ink' : 'text-slate-300 hover:text-white'}`}>
              {when === key && <motion.span layoutId="when-pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} className="absolute inset-0 rounded-xl bg-gold" />}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <GoldButton type="submit" className="w-full lg:w-auto lg:py-4">Check availability <ArrowRight size={16} className="transition group-hover:translate-x-1" /></GoldButton>

      <p className="flex items-center gap-2 text-xs text-slate-300 lg:col-span-3">
        <Clock3 size={14} className="shrink-0 text-gold" />
        <AnimatePresence mode="wait">
          <motion.span key={when + serviceId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            {when === 'now'
              ? 'Quick Turn: around 15 min wait to the next available barber (demo preview).'
              : `${picked?.duration} mins · ₹${picked?.price} · pick your slot after you sign in.`}
          </motion.span>
        </AnimatePresence>
      </p>
    </motion.form>
  )
}

function Hero({ go, services }) {
  const { scrollY } = useScroll()
  const bgY = useTransform(scrollY, [0, 700], [0, 90])
  const lines = [['Your', 'Style.'], ['Your', 'Time.'], ['Your', 'Turn.']]

  return (
    <section id="home" className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-ink text-white">
      <motion.div style={{ y: bgY }} className="absolute inset-x-0 -bottom-24 -top-6 -z-10 bg-gradient-to-br from-navy to-ink">
        <motion.img src={salons[0]?.image} alt="" initial={{ scale: 1.2 }} animate={{ scale: 1.04 }} transition={{ duration: 2.6, ease: EASE }} className="h-full w-full object-cover object-[78%_center]" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/70" />
        <motion.div aria-hidden="true" animate={{ x: [0, 50, 0], y: [0, 30, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }} className="absolute -left-20 top-1/3 h-80 w-80 rounded-full bg-gold-deep/25 blur-3xl" />
      </motion.div>

      <SpinBadge />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 pb-10 pt-32 lg:px-8 lg:pt-36">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mb-6 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[0.28em] text-gold">
          <span className="h-px w-10 bg-gold" /> A better way to book your time
        </motion.p>
        <h1 className="max-w-4xl font-display text-[clamp(3.1rem,10.5vw,7.2rem)] leading-[0.93] tracking-tight">
          {lines.map((line, li) => (
            <span key={li} className="block overflow-hidden pb-[0.12em]">
              {line.map((word, wi) => (
                <motion.span key={word + wi} initial={{ y: '115%' }} animate={{ y: 0 }} transition={{ duration: 0.9, delay: 0.2 + li * 0.18 + wi * 0.07, ease: EASE }} className={`relative mr-[0.25em] inline-block ${li === 2 ? 'italic text-gold' : ''}`}>
                  {word}
                  {li === 2 && wi === 1 && (
                    <svg aria-hidden="true" viewBox="0 0 300 12" preserveAspectRatio="none" className="absolute inset-x-0 bottom-[-0.02em] h-[0.1em] w-full overflow-visible">
                      <motion.path d="M2 8 C 70 1, 150 12, 298 3" fill="none" stroke="#d9b78c" strokeWidth="3" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.5, duration: 0.9, ease: 'easeInOut' }} />
                    </svg>
                  )}
                </motion.span>
              ))}
            </span>
          ))}
        </h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.7 }} className="mt-7 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
          Book your salon visit in a few taps. Know the price, choose your service and spend less time waiting.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.05, duration: 0.7 }} className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-slate-300">
          <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-gold" /> Clear pricing</span>
          <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-gold" /> Less waiting</span>
          <span className="inline-flex items-center gap-2"><CheckCircle2 size={16} className="text-gold" /> Book in a few taps</span>
        </motion.div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pb-8 lg:px-8">
        <BookingBar services={services} go={go} />
      </div>
    </section>
  )
}

function Marquee() {
  const words = ['Haircut & Styling', 'Beard & Grooming', 'Hair Spa', 'Facial & Skin Care', 'Quick Turn', 'Clear pricing']
  const row = [...words, ...words]
  return (
    <div className="overflow-hidden bg-gold py-4 text-ink" aria-hidden="true">
      <div className="marquee-track flex w-max gap-10 whitespace-nowrap font-display text-xl sm:text-2xl">
        {[...row, ...row].map((w, i) => (
          <span key={i} className="flex items-center gap-10">{w} <Scissors size={16} /></span>
        ))}
      </div>
    </div>
  )
}

function Services({ services, go }) {
  return (
    <section id="services" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-20 sm:py-28 lg:px-8">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <motion.div {...reveal()}>
          <Eyebrow>Made for your routine</Eyebrow>
          <Title className="mt-3">Everything your look <i className="text-gold-deep">needs.</i></Title>
        </motion.div>
        <motion.p {...reveal(0.1)} className="max-w-sm text-sm leading-6 text-slate-500">Choose a service, compare what matters and book with confidence. More services can be loaded per salon from Supabase.</motion.p>
      </div>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {services.map((s, i) => {
          const Icon = SERVICE_ICONS[i] || Star
          return (
            <motion.article key={s.id} {...reveal(i * 0.08)} className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-sand bg-white p-6 shadow-[0_18px_40px_rgba(74,54,34,0.06)] transition duration-300 hover:-translate-y-2 hover:border-gold-deep/40 hover:shadow-[0_28px_60px_rgba(74,54,34,0.14)]">
              <span aria-hidden="true" className="absolute right-5 top-2 font-display text-6xl text-sand transition duration-300 group-hover:text-gold/60">{String(i + 1).padStart(2, '0')}</span>
              <div className="relative grid h-12 w-12 place-items-center rounded-2xl bg-sand text-gold-deep transition duration-300 group-hover:rotate-6 group-hover:bg-ink group-hover:text-gold"><Icon size={21} /></div>
              <h3 className="mt-10 font-display text-2xl leading-tight">{SERVICE_NAMES[i] || s.name}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{s.description}</p>
              <div className="mt-6 flex items-end justify-between border-t border-sand pt-4">
                <div><p className="text-xl font-bold">₹{s.price}</p><p className="text-xs text-slate-400">{s.duration} mins</p></div>
                <button type="button" onClick={() => go('/register')} className="rounded-full bg-navy px-4 py-2 text-xs font-bold text-white transition hover:bg-gold-deep">Book now</button>
              </div>
            </motion.article>
          )
        })}
      </div>
    </section>
  )
}

function QueueDemo() {
  const [ahead, setAhead] = useState(3)
  useEffect(() => {
    const t = setInterval(() => setAhead((a) => (a === 0 ? 3 : a - 1)), 2400)
    return () => clearInterval(t)
  }, [])
  const wait = ahead * 4 + 3
  const filled = 4 - ahead

  return (
    <div role="img" aria-label="Animated preview of a queue token and estimated wait time" className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Queue preview</span>
        <span className="rounded-full bg-amber-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-300">Demo preview</span>
      </div>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-xs text-slate-400">Your token</p>
          <p className="font-display text-6xl text-gold sm:text-7xl">Q-04</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Estimated wait</p>
          <AnimatePresence mode="wait">
            <motion.p key={ahead} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }} className={`font-display text-4xl sm:text-5xl ${ahead === 0 ? 'text-emerald-300' : 'text-white'}`}>
              {ahead === 0 ? 'Your turn' : `~${wait} min`}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
      <div className="mt-10 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
            <motion.div initial={false} animate={{ scaleX: i < filled ? 1 : 0 }} transition={{ duration: 0.5, ease: EASE }} className={`h-full origin-left ${i === 3 ? 'bg-emerald-300' : 'bg-gold'}`} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-xs text-slate-400">
        <span>Joined</span>
        <span>{ahead === 0 ? 'Next up' : `${ahead} ahead of you`}</span>
        <span>Your turn</span>
      </div>
    </div>
  )
}

function QuickTurn({ go }) {
  return (
    <section id="quick-turn" className="scroll-mt-16 bg-navy px-5 py-20 text-white sm:py-28 lg:px-8">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <motion.div {...reveal()}>
          <Eyebrow light>Skip the calendar</Eyebrow>
          <Title className="mt-3">Need a cut now?<br /><i className="text-gold">Take the next turn.</i></Title>
          <p className="mt-6 max-w-lg leading-7 text-slate-300">Quick Turn connects you to the next available barber. See the estimated wait, claim your queue token and arrive when it is your time.</p>
          <GoldButton onClick={() => go('/register')} className="mt-8">Book Quick Turn <ArrowRight size={16} className="transition group-hover:translate-x-1" /></GoldButton>
        </motion.div>
        <motion.div {...reveal(0.15)}><QueueDemo /></motion.div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    ['1', 'Choose your service', 'See clear prices, durations and available experts in one place.'],
    ['2', 'Book or take Quick Turn', 'Reserve a time or join the next available queue.'],
    ['3', 'Arrive right on time', 'Track your booking and spend less time in the waiting area.'],
  ]
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-20 sm:py-28 lg:px-8">
      <motion.div {...reveal()} className="text-center">
        <Eyebrow>Simple by design</Eyebrow>
        <Title className="mt-3">Three steps to a <i className="text-gold-deep">better</i> visit.</Title>
      </motion.div>
      <div className="relative mt-16 grid gap-5 md:grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-6 hidden h-px bg-sand md:block" aria-hidden="true">
          <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: 'easeInOut' }} className="h-full origin-left bg-gold-deep" />
        </div>
        {steps.map(([n, title, body], i) => (
          <motion.div key={n} {...reveal(i * 0.15)} className="relative text-center">
            <div className="relative z-10 mx-auto grid h-12 w-12 place-items-center rounded-full bg-ink font-display text-xl text-gold ring-8 ring-cream">{n}</div>
            <div className="mt-6 rounded-[2rem] border border-sand bg-white p-6 shadow-[0_18px_40px_rgba(74,54,34,0.05)]">
              <h3 className="font-display text-2xl">{title}</h3>
              <p className="mt-3 leading-7 text-slate-500">{body}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function WhyUs({ services }) {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 sm:pb-28 lg:px-8">
      <div className="grid gap-5 md:grid-cols-3">
        <motion.div {...reveal()} className="rounded-[2rem] bg-ink p-7 text-white sm:p-9 md:col-span-2">
          <WalletCards className="text-gold" size={24} />
          <h3 className="mt-6 font-display text-3xl">Transparent pricing</h3>
          <p className="mt-2 text-sm text-slate-400">Know what you will pay before you confirm.</p>
          <ul className="mt-8 space-y-4">
            {services.map((s, i) => (
              <li key={s.id} className="flex items-baseline gap-3">
                <span>{SERVICE_NAMES[i] || s.name}</span>
                <span className="flex-1 border-b border-dotted border-white/25" />
                <span className="font-display text-xl text-gold">₹{s.price}</span>
              </li>
            ))}
          </ul>
        </motion.div>
        <div className="grid gap-5">
          {[
            [CalendarCheck2, 'Easy appointment booking', 'Find the right service and slot in a few taps.'],
            [Clock3, 'Less waiting time', 'Quick Turn and queue tracking keep your day moving.'],
          ].map(([Icon, title, body], i) => (
            <motion.div key={title} {...reveal(0.1 + i * 0.1)} className="rounded-[2rem] border border-sand bg-white p-7 transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_rgba(74,54,34,0.12)]">
              <Icon className="text-gold-deep" size={22} />
              <h3 className="mt-6 font-display text-2xl leading-tight">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Offers() {
  return (
    <section id="offers" className="scroll-mt-16 bg-sand px-5 py-20 sm:py-28 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <motion.div {...reveal()} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><Eyebrow>Coming soon</Eyebrow><Title className="mt-3">Offers worth <i className="text-gold-deep">waiting</i> for.</Title></div>
          <span className="w-fit rounded-full bg-white/70 px-3 py-2 text-xs font-semibold text-slate-500">Salon-specific offers</span>
        </motion.div>
        <motion.div {...reveal(0.1)} className="relative mt-12">
          <div aria-hidden="true" className="grid select-none gap-4 blur-sm md:grid-cols-3">
            {offers.map((o) => (
              <div key={o.title} className="rounded-[2rem] border border-white/70 bg-white/70 p-6">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gold-deep">{o.badge}</span>
                <h3 className="mt-8 font-display text-2xl">{o.title}</h3>
                <p className="mt-2 text-lg font-bold text-gold-deep">{o.discount}</p>
                <p className="mt-2 text-sm text-slate-500">{o.desc}</p>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full bg-ink px-6 py-3 font-display text-lg text-gold shadow-xl">Coming soon</span>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function FinalCta({ go }) {
  return (
    <section className="px-5 py-20 sm:py-28 lg:px-8">
      <motion.div {...reveal()} className="relative mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] bg-ink px-6 py-14 text-center text-white sm:px-14 sm:py-20">
        <motion.div aria-hidden="true" animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: 'linear' }} className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-2 border-dashed border-gold/30" />
        <motion.div aria-hidden="true" animate={{ rotate: -360 }} transition={{ duration: 55, repeat: Infinity, ease: 'linear' }} className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full border-2 border-dashed border-gold/20" />
        <Eyebrow light>Ready when you are</Eyebrow>
        <h2 className="relative mx-auto mt-4 max-w-2xl font-display text-[clamp(2rem,5.5vw,3.8rem)] leading-[1.05]">Your next turn is <i className="text-gold">a tap away.</i></h2>
        <div className="relative mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <GoldButton onClick={() => go('/register')}>Create your account <ArrowRight size={16} className="transition group-hover:translate-x-1" /></GoldButton>
          <button type="button" onClick={() => go('/login')} className="rounded-full border border-white/25 px-6 py-3.5 text-sm font-semibold transition hover:bg-white/10">I already have an account</button>
        </div>
      </motion.div>
    </section>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const isNativeApp = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
  const [, setAdminClickCount] = useState(0)
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 25 })
  const services = [...serviceCatalog, EXTRA_SERVICE]

  const go = (path, extra = {}) => navigate(path, { state: { from: '/customer/home', intent: path === '/register' ? 'register' : 'booking', ...extra } })
  const handleFooterBrandClick = () => {
    setAdminClickCount((count) => {
      const next = count + 1
      if (next === 10) {
        navigate('/admin/login')
        return 0
      }
      return next
    })
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-cream text-navy">
        <motion.div aria-hidden="true" style={{ scaleX: progress }} className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-gold" />
        <Header go={go} />
        <main>
          <Hero go={go} services={services} />
          <Marquee />
          <Services services={services} go={go} />
          <QuickTurn go={go} />
          <HowItWorks />
          <WhyUs services={services} />
          <Offers />
          <FinalCta go={go} />
        </main>

        {!isNativeApp && (
          <section aria-label="Mobile app download" className="bg-cream px-5 pb-12 lg:px-8">
            <div className="mx-auto flex max-w-7xl justify-center">
              <a
                href="/downloads/The%20Sallon%20app.apk"
                download="The Sallon app.apk"
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-gold px-6 py-3.5 text-sm font-bold text-ink shadow-[0_12px_30px_rgba(217,183,140,0.25)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#e9d2b0] hover:shadow-[0_16px_36px_rgba(217,183,140,0.4)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                Download our app <Download size={16} />
              </a>
            </div>
          </section>
        )}

        <footer className="bg-ink px-5 py-12 text-slate-400 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <button type="button" onClick={handleFooterBrandClick} className="font-display text-2xl text-white">BOOK<span className="text-gold">SALOON</span></button>
              <p className="mt-3 max-w-xs text-sm leading-6">A calmer, clearer way to manage every salon visit.</p>
            </div>
            <div>
              <p className="text-sm font-bold text-white">Explore</p>
              <div className="mt-4 grid gap-2 text-sm">{NAV.map(([label, id]) => <a key={id} href={`#${id}`} className="transition hover:text-gold">{label}</a>)}</div>
            </div>
            <div>
              <p className="text-sm font-bold text-white">Account</p>
              <div className="mt-4 grid justify-start gap-2 text-sm">
                <button type="button" onClick={() => go('/login')} className="text-left transition hover:text-gold">Login</button>
                <button type="button" onClick={() => go('/register')} className="text-left transition hover:text-gold">Register</button>
                <span>Privacy &amp; terms</span>
              </div>
            </div>
          </div>
          <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-5 text-xs">© 2026 BOOKSALOON. Salon details and offers are loaded per tenant.</div>
        </footer>
      </div>
    </MotionConfig>
  )
}
