# Guía de Desarrollo con Chispa

## Estructura de Componentes y `data-cb`

Cuando se trabaja con `chispa` y plantillas HTML, está permitido no mantener la correspondencia jerárquica entre los elementos HTML definidos con `data-cb` y la estructura del objeto pasado a `tpl.fragment` (o funciones similares).

### Regla de Anidamiento

Si un elemento HTML con `data-cb` es hijo de otro elemento con `data-cb`, esta relación no tiene por qué reflejarse en el código TypeScript utilizando la propiedad `nodes`.

**Ejemplo HTML:**

```html
<div data-cb="modal">
	<form data-cb="formulario">
		<button data-cb="botonCancelar">Cancelar</button>
	</form>
</div>
```

**Código TypeScript Plano (recomendado en la mayoria de los casos):**

```typescript
// ESTO ES CORRECTO incluso si los elementos están anidados en el HTML
return tpl.fragment({
    modal: { ... },
    formulario: { ... },
    botonCancelar: { ... }
});
```

**Código TypeScript Anidado (solo recomendado si el anidamiento es muy relevante y se quiere dejar reflejado en el código):**

```typescript
return tpl.fragment({
    modal: {
        // Propiedades del modal (style, etc.)
        nodes: {
            formulario: {
                // Propiedades del formulario (onsubmit, etc.)
                nodes: {
                    botonCancelar: {
                        // Propiedades del botón (onclick, etc.)
                        onclick: () => { ... }
                    }
                }
            }
        }
    }
});
```

## Gestión de Clases y Reactividad

Chispa ofrece formas específicas para manejar clases y reactividad que no requieren el uso explícito de `computed` en todas partes.

### Clases CSS

1.  **Clases Fijas**: Deben definirse directamente en el HTML.

    ```html
    <div class="card p-3" data-cb="myCard">...</div>
    ```

2.  **Clases Variables (`addClass`)**: Utiliza `addClass` para añadir una clase dinámicamente. Si necesitas manejar mas de 1 clase con addClass puedes usar un array.

    ```typescript
    myCard: {
    	addClass: () => 'platform-' + platformName.get();
    }
    ```

3.  **Clases Condicionales Booleanas (`classes`)**: Utiliza el objeto `classes` para activar/desactivar clases según una condición.
    ```typescript
    myCard: {
        classes: {
            'visible': () => isVisible.get(),
            'error': () => hasError.get()
        }
    }
    ```

**Si se usa la propiedad `className`** se reemplazarán todas las clases, ya que esto sobrescribe las clases definidas en el HTML y ninguno de los puntos anteriores tendrá efecto.

### Funciones vs Computed

Para las siguientes propiedades especiales, **NO es necesario usar `computed`**. Puedes pasar una función directamente y Chispa la tratará reactivamente:

- `inner`
- `addClass`
- `classes` (y sus propiedades individuales)
- `style` (y sus propiedades individuales)
- `dataset` (y sus propiedades individuales)

**Ejemplo Correcto:**

```typescript
inner: () => `Hola ${name.get()}`;
```

**Solo usa `computed`** cuando necesites pasar un valor reactivo a una propiedad que no sea una de las anteriores (por ejemplo, `value`, `checked`, `src`, etc., o props custom de un componente hijo).
