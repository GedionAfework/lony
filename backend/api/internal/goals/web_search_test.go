package goals

import (
	"encoding/base64"
	"testing"
)

func TestParseDDGResults(t *testing.T) {
	html := `<div class="result results_links result--ad"><h2><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x.com&amp;u3=1">Ad</a></h2></div>
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.yachtworld.com%2Fyacht%2F2022-sunseeker-55%2F&amp;rut=abc">2022 <b>Sunseeker</b> Manhattan 55</a></h2>
<a class="result__snippet" href="x">Asking <b>$2,450,000</b>. Twin Volvo IPS.</a></div>
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.geocountries.com%2Fprice&amp;rut=abc">Prices</a></h2></div>`
	got := parseDDGResults(html, 8)
	if len(got) != 1 {
		t.Fatalf("want 1 result (ad and junk dropped), got %+v", got)
	}
	r := got[0]
	if r.URL != "https://www.yachtworld.com/yacht/2022-sunseeker-55/" || r.Site != "yachtworld.com" {
		t.Fatalf("url/site: %+v", r)
	}
	if r.Title != "2022 Sunseeker Manhattan 55" || r.Snippet != "Asking $2,450,000. Twin Volvo IPS." {
		t.Fatalf("title/snippet: %q / %q", r.Title, r.Snippet)
	}
}

func TestParseBingImages(t *testing.T) {
	html := `<a class="iusc" m="{&quot;purl&quot;:&quot;https://www.yachtworld.com/yacht/55/&quot;,&quot;murl&quot;:&quot;https://images.boatsgroup.com/1.jpg&quot;,&quot;turl&quot;:&quot;https://ts3.mm.bing.net/th?id=OIP.x&amp;pid=15.1&quot;,&quot;t&quot;:&quot;Sunseeker 55&quot;}" href="/im">
<a class="iusc" m="{&quot;purl&quot;:&quot;https://www.pinterest.com/pin/1&quot;,&quot;murl&quot;:&quot;https://i.pinimg.com/2.jpg&quot;}" href="/im">`
	got := parseBingImages(html, 6)
	if len(got) != 1 {
		t.Fatalf("pinterest should be dropped, got %+v", got)
	}
	if got[0].ImageURL != "https://images.boatsgroup.com/1.jpg" || got[0].Site != "yachtworld.com" || got[0].ThumbURL != "https://ts3.mm.bing.net/th?id=OIP.x&pid=15.1" {
		t.Fatalf("got %+v", got[0])
	}
}

func TestParseBingResults_unwrapsClickLinks(t *testing.T) {
	target := "https://www.zillow.com/homedetails/123"
	wrapped := "https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1" + base64.RawURLEncoding.EncodeToString([]byte(target)) + "&amp;ntb=1"
	html := `<ol><li class="b_algo"><h2><a href="` + wrapped + `" h="ID=1">3 Bed House, Austin</a></h2><div class="b_caption"><p>$450,000 · 3 bd</p></div></li></ol>`
	got := parseBingResults(html, 8)
	if len(got) != 1 || got[0].URL != target || got[0].Snippet != "$450,000 · 3 bd" {
		t.Fatalf("got %+v", got)
	}
}
