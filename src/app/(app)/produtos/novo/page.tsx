import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createProductAction } from "@/app/actions/products";
import { PageHeader, Card } from "@/components/ui";
import { ProductForm } from "@/components/product-form";

export const dynamic = "force-dynamic";

export default async function NovoProdutoPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Novo produto"
        subtitle={<>Cadastro rápido. Você pode preencher só o nome e, opcionalmente, um link de loja. <Link className="text-indigo-600 hover:underline" href="/produtos">Voltar à lista</Link></>}
      />
      <Card>
        <ProductForm action={createProductAction} mode="create" submitLabel="Cadastrar produto" showOffer />
      </Card>
    </>
  );
}
