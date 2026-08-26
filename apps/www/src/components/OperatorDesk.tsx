export function OperatorDesk() {
  return (
    <div className="desk" aria-hidden="true">
      <div className="desk__chrome">
        <span className="desk__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="desk__url">autoseo.run · campaign desk</span>
        <span className="desk__live">approval required</span>
      </div>
      <div className="desk__body">
        <aside className="desk__side">
          <p className="desk__kicker">Retainer</p>
          <h3>Northline · B2B SaaS</h3>
          <dl>
            <div>
              <dt>Constraint</dt>
              <dd>No marketplace inventory</dd>
            </div>
            <div>
              <dt>Bar</dt>
              <dd>Real traffic, topical match</dd>
            </div>
            <div>
              <dt>This month</dt>
              <dd>8 live · 3 in review</dd>
            </div>
          </dl>
        </aside>
        <div className="desk__main">
          <ol className="desk__pipe">
            <li>
              <span>Prospect</span>
              <b>42</b>
            </li>
            <li>
              <span>Qualify</span>
              <b>11</b>
            </li>
            <li className="is-active">
              <span>Draft</span>
              <b>4</b>
            </li>
            <li>
              <span>Live</span>
              <b>8</b>
            </li>
          </ol>
          <article className="desk__pitch">
            <header>
              <p>Pitch · waiting on you</p>
              <h4>Editor at Operations Weekly</h4>
            </header>
            <p>
              Their last three features are all about mid-market onboarding debt — not “great article on
              your site.” The ask is a data note, not a guest post package.
            </p>
            <footer>
              <span>Inbox warmed · 1:1</span>
              <span>Hold send</span>
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
