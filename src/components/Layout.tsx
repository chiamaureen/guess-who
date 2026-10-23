import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

export function Layout() {
  const { pathname, hash } = useLocation();
  const isHowToPlay = pathname === "/" && hash === "#how-to-play";
  const isHome = pathname === "/" && !isHowToPlay;

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Guess Who 首頁">
          <span>
            guess who<span className="brand-dot">.</span>
            <span className="brand-subtitle">猜猜我是誰</span>
          </span>
        </Link>
        <nav aria-label="主要導覽">
          <Link
            to="/"
            className={isHome ? "active" : undefined}
            aria-current={isHome ? "page" : undefined}
          >
            首頁
          </Link>
          <Link
            to="/#how-to-play"
            className={isHowToPlay ? "active" : undefined}
            aria-current={isHowToPlay ? "location" : undefined}
          >
            怎麼玩？
          </Link>
          <NavLink className="nav-join" to="/join">
            加入遊戲 <span aria-hidden="true">↗</span>
          </NavLink>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <Link className="footer-logo" to="/">
          guess who<span>↗</span>
        </Link>
        <p>把熟悉的面孔，變成相聚的樂趣。</p>
        <span>MADE FOR GOOD TIMES · 2026</span>
      </footer>
    </div>
  );
}
