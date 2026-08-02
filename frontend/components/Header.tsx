"use client";
import { clearToken } from "@/lib/api";
import { useRouter } from "next/navigation";
export default function Header(){const router=useRouter();return <header className="topbar"><div className="topbar-inner"><div className="brand"><span className="dot"/>SLE Audit</div><button className="btn btn-light" onClick={()=>{clearToken();router.push('/login')}}>Выйти</button></div></header>}
