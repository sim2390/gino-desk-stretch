// Decides where the card window goes. Pure logic with no Tauri types, tested with `cargo test`.
// Everything here is in physical pixels, except the card's size, which is in logical (CSS) pixels
// and is scaled by the screen the card lands on.
// The card starts in the bottom-right corner of the main screen. Drag it somewhere and it comes
// back to that spot, as long as that screen is still connected.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Screen {
    /// The whole screen, taskbar included.
    pub bounds: Rect,
    /// The part the taskbar / menu bar / dock doesn't cover.
    pub work_area: Rect,
    /// Physical pixels per logical pixel.
    pub scale: f64,
    pub primary: bool,
}

/// Where you dropped the card: its left edge and its bottom edge, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CardPos {
    pub x: i32,
    pub bottom: i32,
}

/// Logical pixels, so the card is never squashed below this on any screen.
const MIN_HEIGHT: f64 = 120.0;

/// Like Math.max(lo, Math.min(v, hi)): if the range is empty, `lo` wins.
/// (`i32::clamp` would panic on a card wider than the screen.)
fn clamp(v: i32, lo: i32, hi: i32) -> i32 {
    v.min(hi).max(lo)
}

/// Logical pixels to physical ones on a screen with this scale.
fn px(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

/// The card's height on this screen: at least MIN_HEIGHT, at most the work area.
fn fit_height(height: f64, scale: f64, area: &Rect) -> i32 {
    clamp(px(height, scale), px(MIN_HEIGHT, scale), area.height)
}

fn overlap(a: &Rect, b: &Rect) -> i64 {
    let (ax, ay, bx, by) = (a.x as i64, a.y as i64, b.x as i64, b.y as i64);
    let w = (ax + a.width as i64).min(bx + b.width as i64) - ax.max(bx);
    let h = (ay + a.height as i64).min(by + b.height as i64) - ay.max(by);
    if w > 0 && h > 0 {
        w * h
    } else {
        0
    }
}

/// The card window's rectangle in physical pixels. `width`, `height` and `edge` (the gap to
/// the screen edge in the default corner) are logical pixels.
pub fn card_bounds(
    screens: &[Screen],
    saved: Option<CardPos>,
    width: f64,
    height: f64,
    edge: f64,
) -> Rect {
    if let Some(saved) = saved {
        // Match on the whole screen, taskbar included, so a card dropped over the taskbar
        // stays on that screen; then keep it inside the part the taskbar doesn't cover.
        // The card is a different size on each screen, so each gets its own rectangle.
        let mut best: Option<&Screen> = None;
        let mut best_overlap = 0;
        for s in screens {
            let h = px(height, s.scale);
            let want = Rect {
                x: saved.x,
                y: saved.bottom.saturating_sub(h),
                width: px(width, s.scale),
                height: h,
            };
            let o = overlap(&want, &s.bounds);
            if o > best_overlap {
                best = Some(s);
                best_overlap = o;
            }
        }
        if let Some(s) = best {
            let area = s.work_area;
            let w = px(width, s.scale);
            let h = fit_height(height, s.scale, &area);
            // The bottom edge stays put, so a taller card grows upward, like in the corner.
            return Rect {
                x: clamp(saved.x, area.x, area.x + area.width - w),
                y: clamp(
                    saved.bottom.saturating_sub(h),
                    area.y,
                    area.y + area.height - h,
                ),
                width: w,
                height: h,
            };
        }
        // That screen is gone: fall back to the corner.
    }
    let Some(s) = screens.iter().find(|s| s.primary).or(screens.first()) else {
        // No screens reported at all (mid-reconfiguration): somewhere visible beats a panic.
        return Rect {
            x: 0,
            y: 0,
            width: px(width, 1.0),
            height: px(height.max(MIN_HEIGHT), 1.0),
        };
    };
    let area = s.work_area;
    let w = px(width, s.scale);
    let h = fit_height(height, s.scale, &area);
    let e = px(edge, s.scale);
    Rect {
        x: area.x + area.width - w - e,
        y: area.y + area.height - h - e,
        width: w,
        height: h,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn rect(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    const fn pos(x: i32, bottom: i32) -> Option<CardPos> {
        Some(CardPos { x, bottom })
    }

    // ---- at 100%: the same cases as the Electron version ----

    // A laptop as the main screen, with a second monitor to its left (listed first, as Windows can).
    // Each has a 48 px taskbar along the bottom, outside its work area.
    const MAIN: Screen = Screen {
        bounds: rect(0, 0, 1920, 1080),
        work_area: rect(0, 0, 1920, 1032),
        scale: 1.0,
        primary: true,
    };
    const LEFT: Screen = Screen {
        bounds: rect(-2560, 0, 2560, 1440),
        work_area: rect(-2560, 0, 2560, 1392),
        scale: 1.0,
        primary: false,
    };

    fn place(saved: Option<CardPos>, height: f64) -> Rect {
        card_bounds(&[LEFT, MAIN], saved, 440.0, height, 8.0)
    }

    #[test]
    fn starts_in_the_bottom_right_corner_of_the_main_screen_not_the_other_one() {
        assert_eq!(place(None, 214.0), rect(1472, 810, 440, 214));
    }

    #[test]
    fn comes_back_to_where_you_dragged_it_on_either_screen() {
        assert_eq!(place(pos(300, 600), 214.0), rect(300, 386, 440, 214));
        assert_eq!(place(pos(-2000, 900), 214.0), rect(-2000, 686, 440, 214));
    }

    #[test]
    fn a_taller_card_grows_upward_from_where_you_left_it() {
        assert_eq!(place(pos(300, 600), 300.0), rect(300, 300, 440, 300));
    }

    #[test]
    fn stays_fully_on_screen_when_dragged_half_off_an_edge() {
        assert_eq!(place(pos(1700, 1100), 214.0), rect(1480, 818, 440, 214));
    }

    #[test]
    fn near_the_top_growing_pushes_it_down_instead_of_off_the_screen() {
        assert_eq!(place(pos(300, 250), 300.0), rect(300, 0, 440, 300));
    }

    #[test]
    fn dropped_over_the_taskbar_it_stays_on_that_screen_just_above_it() {
        assert_eq!(place(pos(-1500, 1610), 214.0), rect(-1500, 1178, 440, 214));
    }

    #[test]
    fn goes_back_to_the_corner_when_that_screen_is_unplugged() {
        let laptop_only = card_bounds(&[MAIN], pos(-2000, 900), 440.0, 214.0, 8.0);
        assert_eq!(laptop_only, rect(1472, 810, 440, 214));
    }

    #[test]
    fn never_taller_than_the_screen_never_shorter_than_120() {
        assert_eq!(place(None, 5000.0).height, 1032);
        assert_eq!(place(None, 50.0).height, 120);
    }

    #[test]
    fn uses_the_first_screen_when_none_is_flagged_primary() {
        let unflagged = Screen {
            primary: false,
            ..MAIN
        };
        assert_eq!(
            card_bounds(&[LEFT, unflagged], None, 440.0, 214.0, 8.0),
            rect(-448, 1170, 440, 214)
        );
    }

    #[test]
    fn no_screens_at_all_does_not_panic() {
        assert_eq!(
            card_bounds(&[], pos(300, 600), 440.0, 214.0, 8.0),
            rect(0, 0, 440, 214)
        );
    }

    // ---- mixed scaling: two 4K screens ----

    // The main screen at 171%, and a second one to its left at 228%, listed first.
    // Both have the 48-logical-pixel taskbar, so it is 82 and 109 physical pixels tall.
    // At 171% the card is 752 x 366 with a 14 px gap; at 228% it is 1003 x 488.
    const PRIMARY_171: Screen = Screen {
        bounds: rect(0, 0, 3840, 2160),
        work_area: rect(0, 0, 3840, 2078),
        scale: 1.71,
        primary: true,
    };
    const SECONDARY_228: Screen = Screen {
        bounds: rect(-3840, 0, 3840, 2160),
        work_area: rect(-3840, 0, 3840, 2051),
        scale: 2.28,
        primary: false,
    };

    fn place_4k(saved: Option<CardPos>, height: f64) -> Rect {
        card_bounds(&[SECONDARY_228, PRIMARY_171], saved, 440.0, height, 8.0)
    }

    #[test]
    fn mixed_default_corner_on_the_171_primary() {
        assert_eq!(place_4k(None, 214.0), rect(3074, 1698, 752, 366));
        // The height limits scale too: 120 logical is 205 physical; the top is the work area.
        assert_eq!(place_4k(None, 50.0).height, 205);
        assert_eq!(place_4k(None, 5000.0).height, 2078);
    }

    #[test]
    fn mixed_saved_spot_on_the_228_secondary() {
        assert_eq!(
            place_4k(pos(-3000, 1500), 214.0),
            rect(-3000, 1012, 1003, 488)
        );
        // A taller card grows upward from the same bottom edge, at that screen's scale.
        assert_eq!(
            place_4k(pos(-3000, 1500), 300.0),
            rect(-3000, 816, 1003, 684)
        );
    }

    #[test]
    fn mixed_dropped_over_the_secondarys_taskbar() {
        // The bottom edge lands in the taskbar (2051..2160): the card stays on that screen, just above it.
        assert_eq!(
            place_4k(pos(-2000, 2140), 214.0),
            rect(-2000, 1563, 1003, 488)
        );
    }

    #[test]
    fn mixed_straddling_the_seam_goes_to_the_screen_holding_most_of_it() {
        // Mostly on the secondary: pulled fully onto it, at its size.
        assert_eq!(
            place_4k(pos(-600, 1500), 214.0),
            rect(-1003, 1012, 1003, 488)
        );
        // Mostly on the primary: pulled fully onto that one, at its size.
        assert_eq!(place_4k(pos(-100, 1000), 214.0), rect(0, 634, 752, 366));
    }

    #[test]
    fn mixed_secondary_unplugged_goes_back_to_the_primary_corner() {
        let primary_only = card_bounds(&[PRIMARY_171], pos(-3000, 1500), 440.0, 214.0, 8.0);
        assert_eq!(primary_only, rect(3074, 1698, 752, 366));
    }
}
