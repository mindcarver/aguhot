import { expect, test } from "@playwright/test";

/**
 * Public-surface a11y baseline e2e — Story 3.5.
 *
 * Surface-anchored coverage for the AC1 / AC2 baseline laid down in 3.5:
 *
 *   - AC1 reachability: Tab through `/` and assert the sequence hits real
 *     `<a>`/`<button>`/`<input>` focusable elements (never a `<div>`), i.e.
 *     no `div onClick` trap exists on any public surface.
 *   - AC1 skip-to-content: the skip-link is the first focusable element,
 *     and activating it (Enter) moves focus to `<main id="main">` so keyboard
 *     readers can bypass the entire nav.
 *   - AC1 visible focus: a keyboard-focused nav link shows a non-`none`
 *     outline with the brand `--color-focus-ring` color (the global
 *     `:where(...):focus-visible` rule in globals.css is in effect for
 *     elements without a component-level `focus:ring-*` class).
 *   - AC2 non-color guard: `/design` (DB-free) renders the three ReactionChip
 *     tones with visible CJK text 「涨」「跌」「平」 — color is not the only
 *     signal. This locks the color+text invariant against a silent color-only
 *     regression.
 *
 * Infrastructure note: `/` is `force-dynamic` and reads `published_hot_events`
 * at request time (AD-3 public read — same as home.spec.ts), so this file
 * requires a reachable local PG `aguhot_dev`. `/design` is DB-free (a static
 * server component rendering token samples), so the AC2 guard has no DB
 * dependency.
 *
 * The skip-link is an unscoped `<a href="#main">` rendered before `<PublicNav>`
 * inside `(public)/layout.tsx`. navigation.spec.ts (Story 6.1 rewrite) scopes
 * its link assertions to the `banner` (sticky top-bar header, all widths) /
 * `dialog` (mobile drawer) landmarks, so adding a pre-nav link here does NOT
 * perturb those existing assertions.
 */

test.describe("公开页面语义与键盘可达基线 (Story 3.5) @a11y", () => {
  test("键盘 Tab 序列命中真实可聚焦元素，无 div-onclick 陷阱 (AC1 可达)", async ({ page }) => {
    const response = await page.goto("/");
    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.status(), "homepage status should be 200").toBe(200);

    // Reset focus to the document body so the first Tab lands on the
    // intended first-focusable (the skip-link). Playwright's default focus
    // state can vary by browser; this makes the sequence deterministic.
    await page.evaluate(() => document.body.focus());

    // The first Tab MUST land on the skip-link — it is the first focusable
    // element in the (public) route tree. Pin the identity (not just "an
    // <a>") by comparing the focused element to the skip-link locator.
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: /跳至主要内容/ });
    await expect(skipLink).toBeFocused();

    // Record the first stop's tag for the sequence-membership assertions
    // below, then continue Tabbing through the rest of the page.
    const seenTags: string[] = [
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName ?? ""),
    ];

    // Tab through a bounded number of additional stops — enough to traverse
    // the primary nav links and the global search input. We do NOT assert
    // the whole page; we assert (a) at least one A and one INPUT are reached,
    // and (b) no activeElement is ever a `<div>` (div-onclick trap).
    for (let i = 0; i < 11; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.tagName ?? "",
      );
      if (tag) seenTags.push(tag);
      // AC1: every keyboard focus stop MUST be a real focusable element type.
      // A `<div>` here would indicate a `div onClick` trap (keyboard
      // unreachable interaction) — the baseline this story guards against.
      expect(tag, `Tab stop #${i + 2} must not be a <div> onclick trap`).not.toBe("DIV");
    }

    // The sequence must contain real focusable types beyond the skip-link:
    // at least one <A> (nav links) and one <INPUT> (the global search box).
    // This is the surface proof of AC1 "all core interactions reachable".
    expect(seenTags, "Tab sequence must include at least one link").toContain("A");
    expect(seenTags, "Tab sequence must include at least one input (global search)").toContain(
      "INPUT",
    );
  });

  test('skip-link 按 Enter 后焦点移至 <main id="main"> (AC1 可达基线原语)', async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.body.focus());

    const skipLink = page.getByRole("link", { name: /跳至主要内容/ });

    // First Tab reaches the skip-link.
    await page.keyboard.press("Tab");
    await expect(skipLink).toBeFocused();

    // Activate it. Because `<main tabIndex={-1}>` is programmatically
    // focusable, the browser moves focus to #main instead of jumping to the
    // first link inside main.
    await page.keyboard.press("Enter");

    // `expect.poll` because focus assignment after hash navigation can be
    // async in some browsers; poll until activeElement.id settles on "main".
    await expect
      .poll(async () => {
        const id = await page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.id ?? "",
        );
        return id;
      }, 'focus should move to <main id="main"> after skip-link activation')
      .toBe("main");
  });

  test("skip-link 未聚焦时视觉隐藏、不占布局 (sr-only)", async ({ page }) => {
    await page.goto("/");

    const skipLink = page.getByRole("link", { name: /跳至主要内容/ });

    // `sr-only` clips the link to a 1px box and pulls it out of the normal
    // flow, so a sighted mouse user never perceives it until keyboard focus
    // reveals it (focus:not-sr-only). A skip-link that is always visible
    // would be a layout/visual defect — this guards that contract.
    const box = await skipLink.boundingBox();
    expect(box, "skip-link must exist in the DOM").not.toBeNull();
    expect(
      box!.width,
      "unfocused skip-link must be sr-only (clipped to ≤1px wide)",
    ).toBeLessThanOrEqual(1);
    expect(
      box!.height,
      "unfocused skip-link must be sr-only (clipped to ≤1px tall)",
    ).toBeLessThanOrEqual(1);
  });

  test("既有 SearchBox ring 未被全局焦点规则覆盖 (AC1 不回归)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.body.focus());

    // Tab until the global search input (in PublicNav) is focused.
    let inputFocused = false;
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.tagName ?? "",
      );
      if (tag === "INPUT") {
        inputFocused = true;
        break;
      }
    }
    expect(inputFocused, "global search input must be keyboard-reachable").toBe(true);

    // SearchBox keeps its own `focus-visible:ring-2` (Tailwind ring compiles
    // to box-shadow). The global `:where(...):focus-visible` rule has
    // specificity 0, so it must NOT override the component ring — assert the
    // ring (box-shadow) is still present AND carries the brand focus-ring
    // color, not just any shadow (a generic elevation shadow would falsely
    // satisfy a bare `!== "none"` check). Tailwind serializes the ring color
    // via `--tw-ring-color` set to the focus-ring token.
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? getComputedStyle(el).boxShadow : "none";
        });
      }, "SearchBox ring (box-shadow) must survive the global focus rule")
      .not.toBe("none");
    const ringShadow = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).boxShadow : "";
    });
    expect(
      ringShadow.replace(/[\s,]/g, ""),
      "SearchBox ring must carry the brand focus-ring color (#335a91), not a generic shadow",
    ).toMatch(/51.*90.*145/);
  });

  test("键盘聚焦的 nav 链接显示品牌色可见焦点 outline (AC1 可见焦点)", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.body.focus());

    // Tab past the skip-link (first stop) to reach the first nav link.
    await page.keyboard.press("Tab"); // skip-link
    await page.keyboard.press("Tab"); // → first focusable nav element

    // The activeElement is a nav link without any component-level
    // `focus:ring-*` class, so it should pick up the global
    // `:where(a, button, ...):focus-visible` outline rule from globals.css.
    // Asserting outline-style != "none" is the surface proof the rule is in
    // effect (a regression that removes the rule collapses outline-style
    // back to the browser default `none` for plain links).
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (el === null) return "none";
          return getComputedStyle(el).outlineStyle;
        });
      }, "focused nav link must have a non-none outline-style")
      .not.toBe("none");

    // outline-color must be the brand focus-ring color #335A91. Browsers
    // serialize this as either "rgb(51, 90, 145)" (CSS Color 3, comma) or
    // "rgb(51 90 145)" (CSS Color 4, space) — tolerate both so the guard
    // survives a serialization change while still pinning token drift (a
    // transparent/wrong-color value fails the channel-equality check).
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? getComputedStyle(el).outlineColor : "";
        });
      }, "focused nav link outline-color must be brand --color-focus-ring (#335a91)")
      .toContain("51");
    const outlineColor = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineColor : "";
    });
    expect(
      outlineColor.replace(/[\s,]/g, ""),
      "outline-color channels must equal #335a91 regardless of rgb serialization",
    ).toMatch(/51.*90.*145/);
  });

  test("/design 三态 ReactionChip 各含可见文字「涨」「跌」「平」(AC2 非颜色守卫)", async ({
    page,
  }) => {
    // `/design` is DB-free (static server component rendering token samples),
    // so this AC2 guard has zero DB/seed dependency.
    const response = await page.goto("/design");
    expect(response, "/design should respond").not.toBeNull();
    expect(response!.status(), "/design status should be 200").toBe(200);

    // The three ReactionChip tones pair a market color class with the CJK
    // text label (涨/跌/平). To prove AC2's "color is not the only signal"
    // we assert each label is VISIBLE INSIDE a market-colored chip element
    // — i.e. color and text coexist on the same node. A future color-only
    // variant (label removed or hidden) would fail here instead of silently
    // regressing AC2. Scoping to the market color class also proves the
    // label belongs to a reaction chip, not some unrelated node.
    await expect(
      page.locator('[class*="market-up-soft"]').filter({ hasText: "涨" }),
      "涨 chip must carry market-up color AND visible 涨 text",
    ).toBeVisible();
    await expect(
      page.locator('[class*="market-down-soft"]').filter({ hasText: "跌" }),
      "跌 chip must carry market-down color AND visible 跌 text",
    ).toBeVisible();
    await expect(
      page.locator('[class*="market-flat-soft"]').filter({ hasText: "平" }),
      "平 chip must carry market-flat color AND visible 平 text",
    ).toBeVisible();
  });

  test("匿名访问 / 与 /design 均返回 200、无 /login 重定向 (AD-8)", async ({ page }) => {
    for (const href of ["/", "/design"]) {
      const response = await page.goto(href);
      expect(response, `${href} should respond`).not.toBeNull();
      expect(response!.status(), `${href} status should be 200`).toBe(200);
      expect(response!.url(), `${href} should not redirect to login`).not.toMatch(/\/login/);
    }
  });
});

/**
 * Touch-target + reduced-motion baseline e2e — Story 3.6.
 *
 * Surface-anchored coverage for the AC1 baseline laid down in 3.6:
 *
 *   - AC1 touch target: `/design` (DB-free) renders FilterPill samples
 *     (`全部` / `市场反应`). FilterPill is the representative「密集小标签」
 *     control (UX-DR13) — one pillClass change covers home 筛选 / topics 目录 /
 *     search 主题命中 / detail 关联 / `/design` five surfaces. Asserting the
 *     rendered height ≥ 44px proves the `min-h-11` token landed and is
 *     respected by the flex container (the `<span>` form shares pillClass with
 *     the `<Link>` form, so this also covers the interactive variant).
 *   - AC1 reduced motion: under `reducedMotion: "reduce"`, the global
 *     `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { ...
 *     !important } }` rule in globals.css must collapse EVERY transition to
 *     ~0ms. We prove the MECHANISM (not a specific element) by injecting a
 *     probe `<div style="transition:color 150ms ease">` and asserting its
 *     computed `transition-duration` is NOT `150ms` and resolves to ≤ 1ms —
 *     the same `* !important` mechanism that degrades the daily
 *     `transition-colors` hover. Anchored on `/design` (DB-free) to avoid the
 *     `/daily` seed dependency (daily's seeded transition behavior is deferred;
 *     the probe proves the CSS mechanism that would degrade it).
 *
 * Infrastructure note: both tests anchor on `/design` (DB-free static server
 * component), so this file adds NO new DATABASE_URL / seed dependency beyond
 * what the 3.5 `@a11y` describe already requires (the `/` first test needs PG;
 * `/design` does not). The reduced-motion test lives in its own describe with
 * `test.use({ contextOptions: { reducedMotion: "reduce" } })` so the emulation
 * is scoped to that test only (the touch-target test needs the default
 * no-preference context). Playwright 1.60 does not expose `reducedMotion` as a
 * standalone test option (unlike `colorScheme`/`viewport`); it is passed via
 * `contextOptions` (a `BrowserContextOptions` passthrough) to
 * `browser.newContext()`, which sets the browser's `prefers-reduced-motion:
 * reduce` media query — the same OS-level preference a reader sets.
 */
test.describe("公开页面触控热区与减少动态效果支持 (Story 3.6) @a11y", () => {
  test("FilterPill 触控热区高度 ≥ 44px (AC1 触控尺寸)", async ({ page }) => {
    // `/design` is DB-free (static server component rendering token samples),
    // so this touch-target guard has zero DB/seed dependency.
    const response = await page.goto("/design");
    expect(response, "/design should respond").not.toBeNull();
    expect(response!.status(), "/design status should be 200").toBe(200);

    // FilterPill renders two samples on /design: `全部` (default) and
    // `市场反应` (active). Both share pillClass (`min-h-11`). Assert the
    // `全部` pill's rendered height ≥ 44px — the AC1 touch-target floor
    // (UX-DR13「密集小标签」baseline). `min-h-11` = 44px (the existing token
    // nav/SearchBox/FollowButton share). A regression that removes `min-h-11`
    // from pillClass collapses the height back to ~28px (py-1 + text-sm) and
    // fails here.
    const pill = page.getByText("全部", { exact: true }).first();
    const box = await pill.boundingBox();
    expect(box, "FilterPill「全部」must exist in the DOM").not.toBeNull();
    expect(
      box!.height,
      "FilterPill rendered height must be ≥ 44px (min-h-11 touch target, AC1)",
    ).toBeGreaterThanOrEqual(44);
  });

  /**
   * Matrix row 2 — empty-state CTA touch target ≥ 44px.
   *
   * Covers I/O & Edge-Case Matrix row 2: "空态 CTA 移动端点击 (AC1 触控)" —
   * home/favorites/search 空态 CTA ≥ 44px (min-h-11). The search no-results
   * state renders a `<Link href="/">`「返回首页」CTA with `min-h-11`. Asserting
   * its boundingBox().height ≥ 44 proves the touch-target floor landed on the
   * empty-state return path. Anchored on `/search?q=zzznomatch-x1y2z3` (local
   * PG, same DATABASE_URL dependency as home.spec — the @a11y suite already
   * requires local PG `aguhot_dev`). The no-results marker is asserted visible
   * BEFORE the CTA so a height-regression failure is distinguishable from a
   * DB gibberish collision / missing-CTA failure (and the locator doesn't
   * time out on the wrong cause).
   */
  test("search 空态 CTA「返回首页」触控热区高度 ≥ 44px (矩阵行 2 空态 CTA)", async ({ page }) => {
    const response = await page.goto("/search?q=zzznomatch-x1y2z3");
    expect(response, "/search?q=zzznomatch-x1y2z3 should respond").not.toBeNull();
    expect(response!.status(), "/search status should be 200").toBe(200);
    // AC: the page responded 200 and is not a redirect (e.g. to /login).
    expect(response!.url(), "/search should not redirect").not.toMatch(/\/login/);
    await expect(
      page.getByText(/未找到与/),
      "no-results marker must be visible (confirms zero-hit empty state before asserting CTA height)",
    ).toBeVisible();

    // The no-results state renders a `<Link href="/">`「返回首页」CTA. Its
    // className carries `min-h-11` (44px). A regression that removes the token
    // collapses the height back to ~28px (py-1 + text-sm) and fails here.
    const cta = page.getByRole("link", { name: /返回首页/ }).first();
    const box = await cta.boundingBox();
    expect(box, "search empty-state CTA must exist in the DOM").not.toBeNull();
    expect(
      box!.height,
      "search empty-state CTA height must be ≥ 44px (min-h-11 touch target, matrix row 2)",
    ).toBeGreaterThanOrEqual(44);
  });

  /**
   * Matrix row 3 — return-link touch target ≥ 44px.
   *
   * Covers I/O & Edge-Case Matrix row 3: "返回链接 / 证据外链移动端点击 (AC1 触控)"
   * — detail BackLink / daily 返回 / topics 返回 / detail「原文链接 ↗」 ≥ 44px.
   * `/daily` renders its「← 返回首页」return link UNCONDITIONALLY at the top of
   * the page (it does NOT call `notFound()` when `digest === null` — it renders
   * a degraded state with the return link still present), so this test has no
   * seed dependency beyond the @a11y suite's existing local PG requirement.
   */
  test("/daily 返回首页链接触控热区高度 ≥ 44px (矩阵行 3 返回链接)", async ({ page }) => {
    const response = await page.goto("/daily");
    expect(response, "/daily should respond").not.toBeNull();
    expect(response!.status(), "/daily status should be 200").toBe(200);
    expect(response!.url(), "/daily should not redirect").not.toMatch(/\/login/);

    // The「← 返回首页」link renders unconditionally at the top of /daily
    // (above the digest-dependent ternary). Its className carries `min-h-11`.
    // The `←` glyph lives in an `<span aria-hidden>`, so the accessible name
    // is `返回首页` — `getByRole("link", { name: /返回首页/ })` matches.
    const returnLink = page.getByRole("link", { name: /返回首页/ }).first();
    const box = await returnLink.boundingBox();
    expect(box, "/daily return link must exist in the DOM").not.toBeNull();
    expect(
      box!.height,
      "/daily return link height must be ≥ 44px (min-h-11 touch target, matrix row 3)",
    ).toBeGreaterThanOrEqual(44);
  });

  /**
   * Matrix row 5 — default (no reduced-motion preference) does NOT regress.
   *
   * Covers I/O & Edge-Case Matrix row 5: "默认（无减动效偏好）浏览 daily（不回归）"
   * — default users keep their 150ms `transition-colors` hover (the global
   * `@media (prefers-reduced-motion: reduce)` rule must NOT fire without the
   * preference). This is the mirror of the reduced-motion probe test (which
   * asserts ≤1ms under the preference); here, in the DEFAULT context (no
   * `reducedMotion` override), a probe `<div style="transition: color 150ms
   * ease">` must keep `transition-duration: "150ms"` — proving the media query
   * is correctly scoped and default users suffer no regression. Anchored on
   * `/design` (DB-free).
   */
  test("默认无减动效偏好下 transition 不被降级 (矩阵行 5 不回归)", async ({ page }) => {
    const response = await page.goto("/design");
    expect(response, "/design should respond").not.toBeNull();
    expect(response!.status(), "/design status should be 200").toBe(200);

    // First prove the DEFAULT context has no reduced-motion preference —
    // `matchMedia` must report false. If this fails, the test is running under
    // an unintended preference and the "no regression" assertion is void.
    const prefersReduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(
      prefersReduced,
      "default context must NOT set prefers-reduced-motion (matrix row 5 no-regression mirror)",
    ).toBe(false);

    // Inject a probe with a 150ms transition. Under the DEFAULT context the
    // global `@media (prefers-reduced-motion: reduce) { * !important }` rule
    // is NOT in effect, so the probe's inline `transition: color 150ms ease`
    // must be honored as-is — the computed `transition-duration` resolves to
    // 150ms. Browsers serialize sub-second durations as seconds (e.g.
    // "0.15s"), so parse to ms (mirroring the reduced-motion probe's parsing)
    // and assert equality with 150. A regression where the media query leaks
    // into the default context (e.g. missing `@media` wrapper) would collapse
    // this to ≤ 1ms and fail here.
    const transitionDuration = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.transition = "color 150ms ease";
      probe.textContent = "probe";
      document.body.appendChild(probe);
      const duration = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return duration;
    });

    const durationMs = parseFloat(transitionDuration) * 1000;
    expect(
      durationMs,
      "default-context probe transition-duration must resolve to 150ms (media query must NOT fire without the preference — matrix row 5 no regression)",
    ).toBe(150);
  });
});

test.describe("减少动态效果偏好下动效即时切换 (Story 3.6) @a11y", () => {
  // `test.use({ contextOptions: { reducedMotion: "reduce" } })` emulates the
  // OS-level preference for every test in this describe. Playwright passes
  // `reducedMotion` to `browser.newContext()`, which sets the browser's
  // `prefers-reduced-motion: reduce` media query, so `window.matchMedia(...)`
  // reports true and the globals.css media-query rule is in effect. Scoped to
  // this describe so the touch-target test above keeps the default
  // no-preference context. (Playwright 1.60 does NOT expose `reducedMotion` as
  // a standalone test option like `colorScheme`/`viewport`; it must go through
  // `contextOptions` — a BrowserContextOptions passthrough.)
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("reducedMotion reduce 偏好生效 + 探针 transition-duration 近 0 (AC1 减动效)", async ({
    page,
  }) => {
    const response = await page.goto("/design");
    expect(response, "/design should respond").not.toBeNull();
    expect(response!.status(), "/design status should be 200").toBe(200);

    // First prove the emulation took effect — `matchMedia` must report the
    // preference as active. If this fails, the rest of the test is meaningless
    // (the media query would not be in effect and the probe would keep 150ms).
    const prefersReduced = await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(
      prefersReduced,
      "describe-level test.use({reducedMotion:'reduce'}) must set matchMedia prefers-reduced-motion to true",
    ).toBe(true);

    // Inject a probe with a 150ms transition. The global
    // `@media (prefers-reduced-motion: reduce) { *, ::before, ::after {
    // transition-duration: 0.01ms !important; ... } }` rule must override the
    // probe's inline `transition: color 150ms ease`. `!important` author
    // declarations beat normal inline styles — and inline beats normal class
    // rules — so this also proves class-based transitions (like the daily
    // `transition-colors`) are overridden by the same `!important` mechanism.
    // getComputedStyle serializes time in SECONDS, so 150ms comes back as
    // "0.15s" and the rule's 0.01ms as e.g. "0.00001s"; parse to ms (×1000)
    // and assert ≤ 1ms — proving the `* !important` mechanism collapses any
    // transition under the preference. (Daily seeded behavior is deferred;
    // the probe proves the CSS mechanism that degrades the daily hover.)
    const transitionDuration = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.transition = "color 150ms ease";
      probe.textContent = "probe";
      document.body.appendChild(probe);
      const duration = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return duration;
    });

    const durationMs = parseFloat(transitionDuration) * 1000;
    expect(
      durationMs,
      "probe transition-duration must resolve to ≤ 1ms under reduced-motion (global * !important collapses the 150ms inline transition; serialized in seconds so ×1000)",
    ).toBeLessThanOrEqual(1);
  });
});
