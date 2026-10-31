import { Link, useParams } from 'react-router-dom';
import { useCategories, useProduct } from '../features/catalog/hooks';
import { ProductForm } from '../features/catalog/ProductForm';
import { emptyProductForm, toProductForm } from '../features/catalog/schemas';
export function ProductFormPage() {
  const { id } = useParams();
  const categories = useCategories();
  const product = useProduct(id);
  if (categories.isPending || (id && product.isPending)) return <p role="status">Loading…</p>;
  if (categories.isError || (id && (product.isError || !product.data)))
    return (
      <div role="alert">
        Could not load this product. <Link to="/products">Back to products</Link>
      </div>
    );
  return (
    <div>
      <Link to="/products" className="text-sm text-slate-600">
        ← Products
      </Link>
      <h1 className="my-5 text-2xl font-semibold">{id ? 'Edit product' : 'Add product'}</h1>
      <ProductForm
        initial={id && product.data ? toProductForm(product.data) : emptyProductForm}
        categories={categories.data ?? []}
        productId={id}
        stockQuantity={product.data?.stockQuantity}
      />
    </div>
  );
}
