"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SubmissionListItem, SubmissionPage, SubmissionStatus } from "@/lib/submissions";

export type CampaignOption = { id: number; title: string };

type Filters = {
  status: SubmissionStatus | "";
  campaignId: string;
  search: string;
  page: number;
  per: number;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; result: SubmissionPage }
  | { kind: "error"; message: string };

type Notice = { kind: "success" | "error"; text: string };

const PER_PAGE_OPTIONS = [25, 50, 100];
const STATUS_OPTIONS: SubmissionStatus[] = ["pending", "approved", "rejected"];

const currency = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const compactNumber = new Intl.NumberFormat("id-ID");
const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" });

function readFilters(params: URLSearchParams): Filters {
  const status = params.get("status");
  const per = Number(params.get("per"));
  const page = Number(params.get("page"));

  return {
    status: STATUS_OPTIONS.includes(status as SubmissionStatus) ? (status as SubmissionStatus) : "",
    campaignId: params.get("campaignId") ?? "",
    search: params.get("search") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    per: PER_PAGE_OPTIONS.includes(per) ? per : 25,
  };
}

function toQueryString(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.campaignId) params.set("campaignId", filters.campaignId);
  if (filters.search) params.set("search", filters.search);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.per !== 25) params.set("per", String(filters.per));
  return params.toString();
}

export default function ReviewTable({ campaigns }: { campaigns: CampaignOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => readFilters(new URLSearchParams(searchParams)));
  const [searchInput, setSearchInput] = useState(filters.search);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const hasRows = state.kind === "ready" && state.result.data.length > 0;
  const queryString = useMemo(() => toQueryString(filters), [filters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) =>
        current.search === searchInput ? current : { ...current, search: searchInput, page: 1 },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }, [queryString, pathname, router]);

  const isInitialLoad = useRef(true);

  useEffect(() => {
    const controller = new AbortController();

    if (isInitialLoad.current) setState({ kind: "loading" });
    else setIsRefreshing(true);

    fetch(`/api/submissions?${queryString}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? "Gagal memuat data.");
        setState({ kind: "ready", result: body as SubmissionPage });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "Gagal memuat data." });
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        isInitialLoad.current = false;
        setIsRefreshing(false);
      });

    return () => controller.abort();
  }, [queryString, reloadToken]);

  const updateFilters = useCallback((patch: Partial<Filters>) => {
    setNotice(null);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const approve = useCallback(async (submission: SubmissionListItem) => {
    if (approvingId !== null) return;

    setApprovingId(submission.id);
    setNotice(null);

    try {
      const response = await fetch(`/api/submissions/${submission.id}/approve`, { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        setNotice({ kind: "error", text: body?.error?.message ?? "Approve gagal." });
      } else {
        setNotice({
          kind: "success",
          text: `${submission.creatorUsername} dibayar ${currency.format(body.netAmount)} (kotor ${currency.format(body.grossAmount)}). Sisa budget campaign ${currency.format(body.remainingBudget)}.`,
        });
      }
    } catch {
      setNotice({ kind: "error", text: "Tidak bisa menghubungi server. Coba lagi." });
    } finally {
      setApprovingId(null);
      setReloadToken((token) => token + 1);
    }
  }, [approvingId]);

  return (
    <div className="panel">
      <div className="toolbar">
        <input
          type="search"
          placeholder="Cari username creator…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Cari username creator"
        />

        <select
          value={filters.status}
          onChange={(event) => updateFilters({ status: event.target.value as Filters["status"] })}
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

        <select
          value={filters.campaignId}
          onChange={(event) => updateFilters({ campaignId: event.target.value })}
          aria-label="Filter campaign"
        >
          <option value="">Semua campaign</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>{campaign.title}</option>
          ))}
        </select>

        <select
          value={filters.per}
          onChange={(event) => updateFilters({ per: Number(event.target.value) })}
          aria-label="Baris per halaman"
        >
          {PER_PAGE_OPTIONS.map((per) => (
            <option key={per} value={per}>{per} / halaman</option>
          ))}
        </select>

        {isRefreshing && <span className="refreshing spacer">Memperbarui…</span>}
      </div>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">{notice.text}</div>
      )}

      {state.kind === "loading" && <p className="state">Memuat submission…</p>}

      {state.kind === "error" && (
        <div className="state">
          <p>{state.message}</p>
          <button className="btn-primary" onClick={() => setReloadToken((token) => token + 1)}>
            Coba lagi
          </button>
        </div>
      )}

      {state.kind === "ready" && !hasRows && (
        <p className="state">Tidak ada submission yang cocok dengan filter ini.</p>
      )}

      {state.kind === "ready" && hasRows && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Campaign</th>
                  <th>Platform</th>
                  <th className="num">Views</th>
                  <th className="num">Estimasi bayar</th>
                  <th>Status</th>
                  <th>Disubmit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.result.data.map((submission) => (
                  <tr key={submission.id}>
                    <td>{submission.creatorUsername}</td>
                    <td>{submission.campaignTitle}</td>
                    <td>{submission.platform}</td>
                    <td className="num">{compactNumber.format(submission.views)}</td>
                    <td className="num">{currency.format(submission.estimatedNet)}</td>
                    <td>
                      <span className={`badge badge-${submission.status}`}>{submission.status}</span>
                    </td>
                    <td>{dateTime.format(new Date(submission.submittedAt))}</td>
                    <td>
                      {submission.status === "pending" && (
                        <button
                          className="btn-primary"
                          disabled={approvingId !== null}
                          onClick={() => approve(submission)}
                        >
                          {approvingId === submission.id ? "Memproses…" : "Approve"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              disabled={filters.page <= 1 || isRefreshing}
              onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}
            >
              Sebelumnya
            </button>
            <span>
              Halaman {state.result.page} dari {state.result.totalPages} ·{" "}
              {compactNumber.format(state.result.total)} submission
            </span>
            <button
              disabled={filters.page >= state.result.totalPages || isRefreshing}
              onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}
            >
              Berikutnya
            </button>
          </div>
        </>
      )}
    </div>
  );
}
