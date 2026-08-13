import { useNavigate } from "react-router-dom";

export function WelcomePage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-full flex-col bg-[#08080A]">
      <div className="flex gap-2 px-5 py-[18px]">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-11 pb-[90px]">
        <div className="flex items-center gap-[26px]">
          <div className="flex h-[88px] w-[88px] items-center justify-center gap-[13px] rounded-full bg-[#F2F2F0]">
            <span className="h-6 w-[11px] rounded-full bg-[#101012]" />
            <span className="h-6 w-[11px] rounded-full bg-[#101012]" />
          </div>
          <div className="text-[76px] leading-none tracking-[-0.03em] text-white">Rakazo</div>
        </div>
        <p className="max-w-[600px] text-center text-[27px] leading-[1.4] text-[#E4E4E6]">
          Your team of always-on agents
          <br />
          that you can give real work to.
        </p>
        <button
          type="button"
          onClick={() => navigate("/sign-in")}
          className="rounded-full bg-[#1B1B1F] px-[34px] py-[15px] text-[19px] text-[#F2F2F3] transition hover:scale-[1.04] hover:bg-[#26262B]"
        >
          Sign in&nbsp;&nbsp;→
        </button>
      </div>
    </div>
  );
}
