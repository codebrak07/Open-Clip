// "In This Town, Your Exam RANK Floats Above Your Head"
// 3D Blocky story with floating rank tags, satirical town rules, and paper-bag twist.
import { setThree, T, D, cl, Classic, loadMouth, renderShot, loadFonts, mat, box, sign, direct, captions, world, indoor, texturize } from '../lib/blocky/index.js'

function rankTag(text, bg = '#d32f2f', fg = '#ffffff') {
  const g = new T.Group()
  const front = sign(text, 2.8, 0.85, bg, fg, 140)
  front.position.set(0, 0, 0.05)
  front.rotation.y = Math.PI
  const back = sign(text, 2.8, 0.85, bg, fg, 140)
  back.position.set(0, 0, -0.05)
  g.add(front, back)
  return g
}

function boxHelmet(color = '#b89467') {
  const g = new T.Group()
  box(g, 1.8, 1.7, 1.8, color, 0, 0.5, 0)
  box(g, 0.45, 0.18, 0.1, '#111111', -0.32, 0.52, 0.92)
  box(g, 0.45, 0.18, 0.1, '#111111', 0.32, 0.52, 0.92)
  box(g, 0.7, 0.1, 0.1, '#111111', 0, 0.22, 0.92)
  box(g, 1.84, 0.2, 0.2, '#9e7b4e', 0, 0.95, 0)
  return g
}

function paperBag() {
  const g = new T.Group()
  box(g, 1.7, 1.8, 1.7, '#c29b68', 0, 0.55, 0)
  box(g, 0.4, 0.16, 0.1, '#111111', -0.3, 0.55, 0.86)
  box(g, 0.4, 0.16, 0.1, '#111111', 0.3, 0.55, 0.86)
  return g
}

function topHat(h = 3.6) {
  const g = new T.Group()
  const brim = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 0.08, 24), mat('#222226'))
  g.add(brim)
  const cylinder = new T.Mesh(new T.CylinderGeometry(0.7, 0.75, h, 24), mat('#222226'))
  cylinder.position.y = h * 0.5
  g.add(cylinder)
  return g
}

function pizzaBox() {
  const g = new T.Group()
  box(g, 2.4, 0.35, 2.4, '#ffd54f', 0, 0.18, 0)
  box(g, 2.3, 0.1, 2.3, '#ffca28', 0, 0.36, 0)
  const label = sign('GOLDEN PIZZA', 2.0, 0.8, '#ff8f00', '#fff', 100)
  label.position.set(0, 0.42, 0)
  label.rotation.x = -Math.PI / 2
  g.add(label)
  return g
}

export default {
  async create({ THREE, scene }) {
    setThree(THREE)
    await loadFonts()

    // 1. World: The High Street
    const w = world({ kind: 'city', theme: 'sunny', seed: 44 })
    scene.add(w.root)
    scene.fog = w.fog
    w.clear(200, 0, 50)
    w.clear(-200, 0, 50)
    w.clear(400, 0, 50)

    const S = { mouth: await loadMouth(), mood: w.mood }

    // 2. Cardboard Town Hall Garage at x = -200
    const hall = new T.Group()
    hall.position.set(-200, 0, 0)
    scene.add(hall)
    box(hall, 16, 0.2, 16, '#9e7b4e', 0, 0.1, 0)
    box(hall, 16, 9, 0.3, '#a68254', 0, 4.5, -8)
    box(hall, 0.3, 9, 16, '#8d6e43', -8, 4.5, 0)
    box(hall, 0.3, 9, 16, '#8d6e43', 8, 4.5, 0)
    box(hall, 17, 0.3, 17, '#b89467', 0, 9.1, 0)
    const hallSign = sign('CITY HALL\nMAYOR (RANK 800,000)', 7.5, 3.2, '#c2185b', '#ffffff', 110)
    hallSign.position.set(0, 7.2, 8.5)
    hall.add(hallSign)
    box(hall, 5, 2.2, 2.8, '#5d4037', 0, 1.1, -2)
    texturize(hall)

    // 3. Wedding Pit at x = 200
    const wed = new T.Group()
    wed.position.set(200, 0, 0)
    scene.add(wed)
    box(wed, 20, 4, 14, '#f8bbd0', 0, 2, -10)
    const arch = sign('WEDDING STAGE\n(HIGH RANK ONLY)', 8, 2.8, '#ad1457', '#ffffff', 120)
    arch.position.set(0, 6.5, -9)
    wed.add(arch)
    box(wed, 14, 0.2, 12, '#37474f', 0, -5.9, 4)
    box(wed, 14, 6, 0.3, '#455a64', 0, -3, -2)
    box(wed, 14, 6, 0.3, '#455a64', 0, -3, 10)
    box(wed, 0.3, 6, 12, '#455a64', -7, -3, 4)
    box(wed, 0.3, 6, 12, '#455a64', 7, -3, 4)
    const ladder = new T.Group()
    for (const sx of [-1, 1]) box(ladder, 0.2, 7.5, 0.2, '#eceff1', sx, 3.75, 0)
    for (let ly = 1; ly < 7.5; ly += 1.2) box(ladder, 2, 0.15, 0.15, '#cfd8dc', 0, ly, 0)
    ladder.position.set(0, -6, 0)
    ladder.rotation.x = -0.15
    wed.add(ladder)
    texturize(wed)

    // 4. Diner at x = 400
    const din = indoor({ kind: 'diner', at: [400, 0, 0], seed: 8 })
    scene.add(din)
    const vipBanner = sign('VIP DIAMOND BOOTH\nAIR 1 RESERVED', 5, 2, '#ffd700', '#222', 120)
    vipBanner.position.set(400, 7.2, -6.5)
    scene.add(vipBanner)

    // 5. Red Carpet on High Street
    S.carpet = new T.Mesh(new T.PlaneGeometry(3.2, 36), new T.MeshStandardMaterial({ color: '#c62828', roughness: 0.8 }))
    S.carpet.rotation.x = -Math.PI / 2
    S.carpet.position.set(0.4, 0.02, 0)
    scene.add(S.carpet)

    // 6. Flying cardboard box
    S.flyingBox = boxHelmet('#b89467')
    scene.add(S.flyingBox)

    // 7. Golden pizza box
    S.pizza = pizzaBox()
    scene.add(S.pizza)

    // 8. Cast
    const C = (o) => { const c = Classic(o); scene.add(c.root); return c }
    S.kid = C({ name: 'kid', skin: '#d3ab88', top: { kind: 'jacket', color: '#1f4e79', inner: '#f2f2f2' }, pants: { kind: 'jeans' }, hair: { style: 'messy', color: '#1a1817' }, scale: 0.95, seed: 1 })
    S.rank1 = C({ name: 'rank1', skin: '#e2bb98', top: { kind: 'hoodie', color: '#ffd700' }, pants: { kind: 'plain', color: '#2b2b2b' }, hair: { style: 'swept', color: '#2b1d0c' }, scale: 1.0, seed: 2 })
    S.lowKid = C({ name: 'lowKid', skin: '#b98b68', top: { kind: 'tee', color: '#d32f2f' }, pants: { kind: 'plain', color: '#37474f' }, hair: { style: 'none' }, scale: 0.9, seed: 3 })
    S.mayor = C({ name: 'mayor', skin: '#8a6248', top: { kind: 'suit', color: '#263238', tie: '#ff5722' }, pants: { kind: 'plain', color: '#263238' }, hair: { style: 'swept', color: '#cfd8dc' }, scale: 1.08, seed: 4 })
    S.groom = C({ name: 'groom', skin: '#c59a74', top: { kind: 'suit', color: '#1a237e', tie: '#e91e63' }, pants: { kind: 'plain', color: '#1a237e' }, hair: { style: 'swept', color: '#3e2723' }, scale: 1.0, seed: 5 })
    S.bride = C({ name: 'bride', skin: '#f5d0b5', top: { kind: 'tee', color: '#fce4ec' }, pants: { kind: 'skirt', color: '#f8bbd0' }, hair: { style: 'bun', color: '#4a2c11' }, scale: 0.95, seed: 6 })
    S.c1 = C({ name: 'c1', skin: '#d7a17c', top: { kind: 'plaid', color: '#388e3c' }, pants: { kind: 'jeans' }, hair: { style: 'none' }, scale: 0.95, seed: 7 })
    S.c2 = C({ name: 'c2', skin: '#e6c3a5', top: { kind: 'tee', color: '#8e24aa' }, pants: { kind: 'plain', color: '#37474f' }, hair: { style: 'long', color: '#1a1817' }, scale: 0.95, seed: 8 })
    S.c3 = C({ name: 'c3', skin: '#b98b68', top: { kind: 'jacket', color: '#f57c00' }, pants: { kind: 'jeans' }, hair: { style: 'none' }, scale: 0.95, seed: 9 })

    S.all = [S.kid, S.rank1, S.lowKid, S.mayor, S.groom, S.bride, S.c1, S.c2, S.c3]

    // 9. Floating tags
    S.tagKid = rankTag('AIR 420,000', '#e65100', '#ffffff')
    S.kid.parts.head.add(S.tagKid)
    S.tagKid.position.set(0, 1.8, 0)

    S.tagRank1 = rankTag('AIR 1', '#ffb300', '#212121')
    S.rank1.parts.head.add(S.tagRank1)
    S.tagRank1.position.set(0, 1.8, 0)

    S.tagLow = rankTag('AIR 750,000', '#d32f2f', '#ffffff')
    S.lowKid.parts.head.add(S.tagLow)
    S.tagLow.position.set(0, 1.8, 0)

    S.tagMayor = rankTag('AIR 800,000', '#c2185b', '#ffffff')
    S.mayor.parts.head.add(S.tagMayor)
    S.tagMayor.position.set(0, 1.8, 0)

    S.tagGroom = rankTag('AIR 650,000', '#d32f2f', '#ffffff')
    S.groom.parts.head.add(S.tagGroom)
    S.tagGroom.position.set(0, 1.8, 0)

    S.tagBride = rankTag('AIR 24', '#00acc1', '#ffffff')
    S.bride.parts.head.add(S.tagBride)
    S.tagBride.position.set(0, 1.8, 0)

    const tc1 = rankTag('AIR 310,000', '#e65100', '#fff')
    S.c1.parts.head.add(tc1); tc1.position.set(0, 1.8, 0)
    const tc2 = rankTag('AIR 95,000', '#1e88e5', '#fff')
    S.c2.parts.head.add(tc2); tc2.position.set(0, 1.8, 0)
    const tc3 = rankTag('AIR 540,000', '#d32f2f', '#fff')
    S.c3.parts.head.add(tc3); tc3.position.set(0, 1.8, 0)

    // 10. Head accessories
    S.kidBox = boxHelmet('#b89467')
    S.kid.parts.head.add(S.kidBox)

    S.rank1Bag = paperBag()
    S.rank1.parts.head.add(S.rank1Bag)

    S.c1Hat = topHat(3.8)
    S.c1.parts.head.add(S.c1Hat)
    S.c1Hat.position.set(0, 0.65, 0)

    return S
  },

  update(env) {
    const { state: S, globalT: t, index: k, raw, dur } = env, p = cl(raw / dur)
    const { kid, rank1, lowKid, mayor, groom, bride, c1, c2, c3 } = S
    const d = direct(env, S.all), { show, cam, at, hop, gest, pop, talk, laugh } = d

    let u = raw
    const cut = (...ws) => { const n = d.cut(...ws); u = d.u; return n }

    S.carpet.visible = false
    S.flyingBox.visible = false
    S.pizza.visible = false
    S.kidBox.visible = k >= 7 && k <= 9
    S.rank1Bag.visible = k === 12 || k === 13
    S.tagKid.visible = true

    let lookPos = [0, 0, 0]

    // Line 0: "In this town, your exam rank floats right above your head for everyone to see."
    if (k === 0) {
      const n = cut('rank', 'head')
      const wz = -8 + raw * 3.5
      show(kid, -1.8, 0, wz, 0, 'neutral'); kid.walk(t * 8)
      show(c1, 2.2, 0, wz + 2.5, 0, 'smile'); c1.walk(t * 8 + 1)
      show(c2, -0.2, 0, wz - 7, 0, 'neutral'); c2.walk(t * 8 + 3)
      if (n === 0) { cam([0.8, 3.2, 12], [0, 4.6, wz], 54) }
      else if (n === 1) { cam([-1.2, 5.0, wz + 6], [-1.8, 5.2, wz], 42, 6.2); pop(kid) }
      else { cam([2.0, 5.2, wz + 7], [1.8, 5.2, wz + 2.5], 40, 6.8); pop(c1) }
      lookPos = [0, 0, wz]
    }

    // Line 1: "Rank 1 gets a penthouse, a red carpet, and free pizza for life."
    else if (k === 1) {
      S.carpet.visible = true
      const n = cut('carpet', 'pizza')
      const rz = -6 + raw * 2.8
      show(rank1, 0.4, 0, rz, 0, 'smile')
      rank1.walk(t * 7); gest(rank1)
      show(c2, -2.8, 0, -7, 60, 'shine'); c2.pose({ head: [-10, 0, 0] })
      show(c3, 3.4, 0, 8, -60, 'shine'); c3.pose({ head: [-10, 0, 0] })
      if (n === 0) { cam([0.4, 1.8, 9], [0.4, 4.2, rz], 52); d.big(1) }
      else if (n === 1) { cam([-1.4, 4.8, rz + 5.5], [0.4, 4.8, rz], 40, 5.8) }
      else { cam([0.4, 2.2, rz + 6], [0.4, 4.5, rz], 46) }
      lookPos = [0.4, 0, rz]
    }

    // Line 2: "Rank 750,000 has to apologize to the sidewalk every time they take a step."
    else if (k === 2) {
      const n = cut('apologize', 'sidewalk')
      const bow = Math.min(1, Math.sin(t * 6) * 0.8 + 0.8)
      show(lowKid, 0, 0, 0, 0, 'sweat')
      lowKid.pose({ head: [35 * bow, 0, 0], torso: [25 * bow, 0, 0], armL: [140, 10], armR: [140, 10] })
      show(c1, 2.6, 0, -4, -30, 'smirk')
      if (n === 0) { cam([1.8, 3.5, 6.5], [0, 3.2, 0], 42, 6.8); d.big(750000) }
      else if (n === 1) { d.shot('medium', lowKid); pop(lowKid) }
      else { cam([-1.6, 3.2, 5.8], [0, 3.0, 0], 44, 6.0) }
      lookPos = [0, 0, 0]
    }

    // Line 3: "Our town mayor is rank 800,000, so he runs city hall from an old cardboard garage."
    else if (k === 3) {
      const n = cut('runs', 'cardboard')
      show(mayor, -200, 0.2, 0.5, 0, n ? 'angry' : 'mad')
      talk(mayor); gest(mayor)
      show(c3, -195.0, 0.2, 5.5, -40, 'neutral')
      if (n === 0) { cam([-200, 4.2, 11], [-200, 3.8, 0], 48); d.big(800000) }
      else if (n === 1) { d.shot('medium', mayor, { side: 15 }); pop(mayor) }
      else { cam([-202.2, 2.8, 8.2], [-200, 4.2, 0], 46) }
      lookPos = [-200, 0, 0]
    }

    // Line 4: "At weddings, the low-rank groom stands in a 6-foot pit and needs a ladder to reach the garland."
    else if (k === 4) {
      const n = cut('stands', 'ladder')
      show(bride, 200, 4, -7, 0, 'cool')
      bride.airborne = true
      show(groom, 200, -6, 0.5, 0, 'tear')
      groom.airborne = true
      groom.pose({ armL: [160, 12], armR: [160, 12], head: [-40, 0, 0] })
      if (n === 0) { cam([200, 2.5, 12], [200, 1.5, -4], 54); d.big(6) }
      else if (n === 1) { cam([202.5, -2.5, 7], [200, -3.5, 0.5], 42, 7.5); pop(groom) }
      else { cam([197.5, 1.5, 9], [200, 3.5, -7], 46) }
      lookPos = [200, 0, 0]
    }

    // Line 5: "So everyone in town does crazy things to hide their number."
    else if (k === 5) {
      const n = cut('crazy', 'hide')
      const wz = -4 + raw * 3.2
      show(c1, -1.8, 0, wz, 0, 'neutral'); c1.walk(t * 8)
      show(c2, 2.4, 0, wz + 3, 0, 'smile'); c2.walk(t * 8 + 2)
      show(kid, 0.2, 0, wz - 6, 0, 'neutral'); kid.walk(t * 8 + 4)
      if (n === 0) { cam([0.5, 3.8, 12], [0, 4.5, wz], 52) }
      else if (n === 1) { d.shot('medium', c1); pop(c1) }
      else { cam([1.8, 4.2, wz + 6.5], [2.4, 4.4, wz + 3], 42) }
      lookPos = [0, 0, wz]
    }

    // Line 6: "Three-foot top hats. Giant beach umbrellas. Even motorcycle helmets at breakfast."
    else if (k === 6) {
      const n = cut('giant', 'motorcycle')
      if (n === 0) {
        show(c1, 0, 0, 0, 0, 'cool'); hop(c1, 0.2, 10); pop(c1)
        d.shot('medium', c1); d.big(3)
      } else if (n === 1) {
        show(c2, 0, 0, 0, 15, 'happy'); pop(c2)
        d.shot('medium', c2, { side: 15 })
      } else {
        show(c3, 0, 0, 0, -10, 'smirk'); pop(c3)
        d.shot('medium', c3, { side: -15 })
      }
      lookPos = [0, 0, 0]
    }

    // Line 7: "And me? I have rank 420,000."
    else if (k === 7) {
      const n = cut('rank', '420000')
      show(kid, 0, 0, 0, 0, 'neutral')
      talk(kid); gest(kid)
      if (n === 0) { d.shot('medium', kid, { side: -10 }) }
      else { d.shot('face', kid); d.big(420000) }
      lookPos = [0, 0, 0]
    }

    // Line 8: "I taped a delivery box over my head 2 years ago and told everyone it was fashion."
    else if (k === 8) {
      const n = cut('head', 'fashion')
      const wz = -4 + raw * 2.8
      show(kid, 0, 0, wz, 0, 'smile')
      kid.walk(t * 7); gest(kid)
      show(c2, 3.4, 0, wz + 2, -60, 'shine')
      if (n === 0) { cam([1.5, 3.6, wz + 7], [0, 4.0, wz], 46, 7.2); d.big(2) }
      else if (n === 1) { d.shot('medium', kid); pop(kid) }
      else { cam([0.8, 3.2, wz + 6], [0, 4.0, wz], 44) }
      lookPos = [0, 0, wz]
    }

    // Line 9: "Then yesterday, a sudden gust of wind blew my box straight into the fountain."
    else if (k === 9) {
      const n = cut('wind', 'straight')
      show(kid, 0, 0, 0, 0, n >= 1 ? 'shock' : 'neutral')
      if (n === 0) {
        d.shot('medium', kid)
      } else {
        S.kidBox.visible = false
        S.flyingBox.visible = true
        const flyT = (raw - at('wind')) / 1.8
        const arcY = 4.2 + Math.sin(Math.min(1, flyT) * Math.PI) * 4.5 - flyT * 2
        S.flyingBox.position.set(Math.sin(flyT * 4) * 2 + flyT * 8, arcY, -flyT * 12)
        S.flyingBox.rotation.x = flyT * 12
        S.flyingBox.rotation.y = flyT * 15
        d.burst('puff', 'wind', [0, 4.2, 0], { n: 18 })
        d.shake('wind', 0.5)
        kid.pose({ armL: [160, 20], armR: [160, 20], head: [-15, 0, 0] })
        hop(kid, 0.3, 12); pop(kid)
        cam([-1.6, 3.8, 6.5], [0, 4.2, 0], 42, 6.8)
      }
      lookPos = [0, 0, 0]
    }

    // Line 10: "Poof. Forty-two people instantly turned and stared right at my shame."
    else if (k === 10) {
      S.kidBox.visible = false
      const n = cut('fortytwo', 'stared')
      show(kid, 0, 0, 0, 0, 'sweat')
      kid.pose({ armL: [40, 10], armR: [40, 10], head: [-10, 0, 0] })
      show(c1, -3.2, 0, -2.5, 60, 'shock'); c1.pose({ head: [-8, 0, 0] })
      show(c2, 3.2, 0, 0, -75, 'shock'); c2.pose({ head: [-8, 0, 0] })
      show(c3, 0.8, 0, 5.0, 175, 'shock'); c3.pose({ head: [-8, 0, 0] })
      if (n === 0) {
        d.burst('puff', 0.1, [0, 3.8, 0], { n: 24 })
        d.shot('medium', kid); pop(kid)
      } else if (n === 1) {
        d.shot('face', kid); d.big(42)
      } else {
        cam([0.5, 2.5, 9.5], [0, 4.0, 0], 50)
      }
      lookPos = [0, 0, 0]
    }

    // Line 11: "I waited for the manager to kick me out of the diner."
    else if (k === 11) {
      S.kidBox.visible = false
      const n = cut('kick', 'diner')
      show(kid, 396, 0.2, 4, 30, 'sad')
      kid.pose({ armL: [145, 8], armR: [145, 8], head: [-20, 0, 0] })
      talk(kid)
      if (n === 0) { d.shot('medium', kid, { side: 20 }) }
      else if (n === 1) { d.shot('face', kid); pop(kid) }
      else { cam([394.5, 3.8, 9.8], [398, 4.0, 0], 48) }
      lookPos = [400, 0, 0]
    }

    // Line 12: "Instead, the kid sitting at the diamond VIP booth stood up."
    else if (k === 12) {
      S.kidBox.visible = false
      const n = cut('vip', 'stood')
      show(kid, 396, 0.2, 4, 30, 'oh')
      show(rank1, 400, 0.2, -4, 0, 'neutral')
      if (n >= 1) { gest(rank1); hop(rank1, 0.2, 8); pop(rank1) }
      if (n === 0) { cam([397.5, 3.8, 8.5], [400, 3.8, -4], 46) }
      else { d.shot('medium', rank1) }
      lookPos = [400, 0, 0]
    }

    // Line 13: "He had a golden AIR 1 above his head, but he was wearing a paper grocery bag."
    else if (k === 13) {
      S.kidBox.visible = false
      const n = cut('head', 'grocery')
      show(rank1, 400, 0.2, -3.5, 0, 'neutral')
      if (n === 0) { d.shot('face', rank1); d.big(1) }
      else { d.shot('medium', rank1); pop(rank1) }
      lookPos = [400, 0, 0]
    }

    // Line 14: "He pulled it off, slid a golden pizza over, and whispered: \"Sit down, bro. Nobody actually likes organic chemistry.\""
    else if (k === 14) {
      S.kidBox.visible = false
      const n = cut('off', 'slid', 'whispered', 'nobody')
      S.pizza.visible = true
      S.pizza.position.set(398.2, 2.4, -1.8)
      show(kid, 396.5, 0.2, -1.8, 90, n >= 2 ? 'smile' : 'oh')
      show(rank1, 400, 0.2, -1.8, -90, 'smile')
      if (n >= 1) {
        S.rank1Bag.visible = false
      }
      if (n >= 2) {
        talk(rank1); gest(rank1)
      }
      if (n === 0) { d.shot('medium', rank1, { side: -20 }) }
      else if (n === 1) { d.shot('face', rank1); pop(rank1) }
      else if (n === 2) { d.shot('medium', rank1, { side: -15 }) }
      else { d.shot('two', kid, { with: rank1 }) }
      lookPos = [400, 0, 0]
    }

    // Line 15: "Turns out, even AIR 1 just wants a friend who does not ask for his notes."
    else {
      S.kidBox.visible = false
      S.rank1Bag.visible = false
      S.pizza.visible = true
      S.pizza.position.set(398.2, 2.4, -1.8)
      const n = cut('friend', 'notes')
      show(kid, 396.2, 0.2, -1.8, 90, 'happy')
      show(rank1, 400.2, 0.2, -1.8, -90, 'happy')
      laugh(kid); laugh(rank1)
      hop(kid, 0.15, 8); hop(rank1, 0.15, 8)
      d.shot('two', kid, { with: rank1 })
      lookPos = [400, 0, 0]
    }

    S.mood('day', lookPos)
    d.done()
  },

  render({ renderer, scene, camera, state }) {
    renderer.toneMapping = T.NoToneMapping
    renderShot(renderer, scene, camera, { dof: state.dof, blur: 0.005, aperture: 0.001 })
  },

  overlay(env) {
    captions(env)
  },
}
